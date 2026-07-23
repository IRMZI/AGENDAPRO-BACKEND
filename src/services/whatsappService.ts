import { randomBytes } from "node:crypto";
import { WhatsappSessionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  wahaOrchestrator,
  type WahaWebhookConfig,
} from "../lib/wahaOrchestrator.js";
import { getCompanyByUserId } from "./companyService.js";

// Mapeamento entre status retornado pelo orquestrador (WAHA) e o enum do DB.
const WAHA_TO_DB: Record<string, WhatsappSessionStatus> = {
  STARTING: WhatsappSessionStatus.created,
  SCAN_QR_CODE: WhatsappSessionStatus.qr_code,
  WORKING: WhatsappSessionStatus.authenticated,
  FAILED: WhatsappSessionStatus.failed,
  STOPPED: WhatsappSessionStatus.disconnected,
};

export const mapWahaStatus = (
  raw: unknown,
): WhatsappSessionStatus | null => {
  if (typeof raw !== "string") return null;
  return WAHA_TO_DB[raw.toUpperCase()] ?? null;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 16);

const generateWahaSessionId = (companyId: string, name?: string) => {
  const shortCompany = companyId.slice(0, 8).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex");
  const slug = name ? slugify(name) : "";
  return slug
    ? `c${shortCompany}-${slug}-${suffix}`
    : `c${shortCompany}-${suffix}`;
};

const isNotFoundError = (err: unknown) => {
  if (err && typeof err === "object" && "statusCode" in err) {
    return (err as { statusCode: number }).statusCode === 404;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("404") || msg.includes("not found");
};

const isOrchestratorOffline = (err: unknown) => {
  if (err && typeof err === "object" && "statusCode" in err) {
    return (err as { statusCode: number }).statusCode === 503;
  }
  return false;
};

// ============================================================
// Ownership / company resolution
// ============================================================

export const requireCompanyForUser = async (userId: string) => {
  const company = await getCompanyByUserId(userId);
  if (!company) {
    const err: any = new Error("Company not found for user");
    err.statusCode = 404;
    throw err;
  }
  return company;
};

const requireSessionOwnedBy = async (
  sessionId: string,
  companyId: string,
) => {
  const session = await prisma.whatsappSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    const err: any = new Error("Session not found");
    err.statusCode = 404;
    throw err;
  }
  if (session.company_id !== companyId) {
    const err: any = new Error("Session does not belong to this company");
    err.statusCode = 403;
    throw err;
  }
  return session;
};

// ============================================================
// Status revalidation
// ============================================================

// Pega o status real no orquestrador e atualiza o DB. Em caso de 404
// no orquestrador (sessao morreu/foi removida), marca local como
// disconnected/inactive. Em outros erros (rede, 500) retorna a row sem
// atualizar, deixando para a proxima vez.
const revalidateSession = async (sessionId: string) => {
  const local = await prisma.whatsappSession.findUnique({
    where: { id: sessionId },
  });
  if (!local) return null;

  try {
    const remote = await wahaOrchestrator.getStatus(local.waha_session_id);
    const mappedStatus =
      mapWahaStatus(remote.status) ??
      mapWahaStatus(remote.state) ??
      local.status;

    const updates: Record<string, unknown> = {
      status: mappedStatus,
      last_seen_at: new Date(),
      updated_at: new Date(),
    };
    if (remote.phoneNumber) updates.phone_number = remote.phoneNumber;
    if (remote.me?.id && !local.phone_number) {
      updates.phone_number = remote.me.id.split("@")[0] ?? null;
    }
    // Estado terminal -> auto-desabilita pra sumir da UI
    if (
      mappedStatus === WhatsappSessionStatus.failed ||
      mappedStatus === WhatsappSessionStatus.disconnected
    ) {
      updates.is_active = false;
    }

    return await prisma.whatsappSession.update({
      where: { id: local.id },
      data: updates,
    });
  } catch (err) {
    if (isNotFoundError(err)) {
      return await prisma.whatsappSession.update({
        where: { id: local.id },
        data: {
          status: WhatsappSessionStatus.disconnected,
          is_active: false,
          updated_at: new Date(),
        },
      });
    }
    // Orquestrador offline ou outro erro: nao quebra o GET, so loga
    if (!isOrchestratorOffline(err)) {
      console.warn(
        `[whatsappService] revalidate ${local.waha_session_id} falhou:`,
        err,
      );
    }
    return local;
  }
};

// ============================================================
// Public API
// ============================================================

export const listSessions = async (companyId: string) => {
  const rows = await prisma.whatsappSession.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { created_at: "desc" },
  });

  const settled = await Promise.all(
    rows.map(async (row) => {
      // Estado terminal -> desativa silenciosamente
      if (
        row.status === WhatsappSessionStatus.failed ||
        row.status === WhatsappSessionStatus.disconnected
      ) {
        await prisma.whatsappSession.update({
          where: { id: row.id },
          data: { is_active: false, updated_at: new Date() },
        });
        return null;
      }
      return revalidateSession(row.id);
    }),
  );

  return settled.filter(
    (s): s is NonNullable<typeof s> =>
      s !== null && s.is_active === true,
  );
};

const buildWebhookConfig = (
  wahaSessionId: string,
): WahaWebhookConfig | null => {
  const base = process.env.BACKEND_PUBLIC_URL;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!base || !secret) return null;
  return {
    url: `${base.replace(/\/$/, "")}/api/whatsapp/webhook/${wahaSessionId}`,
    // Mantido alinhado com os eventos TRATADOS em whatsappChatService
    // (processWebhookEvent): mensagens, ack (+grupo), reações, edição/exclusão,
    // LID resolvido, status/remoção de sessão e presença/typing. Subscrever só o
    // que o handler processa.
    events: [
      "message",
      "message.any",
      "message.ack",
      "message.ack.group",
      "message.reaction",
      "message.edited",
      "message.revoked",
      "lid.resolved",
      "session.status",
      "session.deleted",
      "presence.update",
    ],
    customHeaders: [{ name: "x-webhook-secret", value: secret }],
  };
};

// Limite de conexões WhatsApp por empresa (vendido no plano). 999 = ilimitado.
// Espelha o padrão de max_attendants. Aplicado no servidor (a UI também
// bloqueia, mas o servidor é a fonte da verdade — cada sessão custa infra).
const assertWithinSessionQuota = async (companyId: string) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { max_whatsapp_sessions: true },
  });
  const limit = company?.max_whatsapp_sessions ?? 1;
  if (limit === 999) return;
  const active = await prisma.whatsappSession.count({
    where: { company_id: companyId, is_active: true },
  });
  if (active >= limit) {
    const err: any = new Error(
      `Limite de conexões WhatsApp atingido (${limit}). Faça upgrade do plano para conectar mais números.`,
    );
    err.statusCode = 409;
    throw err;
  }
};

export const createSession = async (companyId: string, name?: string) => {
  await assertWithinSessionQuota(companyId);

  const finalName = name?.trim() || "WhatsApp";
  const wahaSessionId = generateWahaSessionId(companyId, finalName);

  const webhook = buildWebhookConfig(wahaSessionId);
  const remote = await wahaOrchestrator.createSession(
    wahaSessionId,
    companyId,
    webhook ? { webhooks: [webhook] } : undefined,
  );
  const status =
    mapWahaStatus(remote.status) ??
    mapWahaStatus(remote.state) ??
    WhatsappSessionStatus.created;

  return prisma.whatsappSession.create({
    data: {
      company_id: companyId,
      name: finalName,
      waha_session_id: wahaSessionId,
      status,
      engine: "GOWS",
      is_active: true,
    },
  });
};

export const getSessionQr = async (sessionId: string, companyId: string) => {
  const session = await requireSessionOwnedBy(sessionId, companyId);

  const qr = await wahaOrchestrator.getQr(session.waha_session_id);
  const status =
    mapWahaStatus(qr.status) ?? mapWahaStatus(qr.state) ?? session.status;

  // Devolvemos a string CRUA do protocolo WhatsApp. O frontend renderiza
  // como QR usando uma lib (react-qr-code). Se em algum outro fluxo o
  // orquestrador devolver imagem base64, propaga como data URL.
  let qrRaw: string | null = null;
  let qrDataUrl: string | null = null;
  if (typeof qr.qrCode === "string" && qr.qrCode.length > 0) {
    qrRaw = qr.qrCode;
  } else if (typeof qr.qr === "string" && qr.qr.length > 0) {
    qrRaw = qr.qr.startsWith("data:") ? null : qr.qr;
    qrDataUrl = qr.qr.startsWith("data:") ? qr.qr : null;
  }
  if (qr.data && qr.mimetype) {
    qrDataUrl = `data:${qr.mimetype};base64,${qr.data}`;
  }

  const sessionUpdates: Record<string, unknown> = {
    status,
    last_seen_at: new Date(),
    updated_at: new Date(),
  };
  if (
    status === WhatsappSessionStatus.failed ||
    status === WhatsappSessionStatus.disconnected
  ) {
    sessionUpdates.is_active = false;
  }
  await prisma.whatsappSession.update({
    where: { id: session.id },
    data: sessionUpdates,
  });

  return { status, qr: qrRaw, qrImage: qrDataUrl };
};

export const refreshSessionStatus = async (
  sessionId: string,
  companyId: string,
) => {
  await requireSessionOwnedBy(sessionId, companyId);
  return revalidateSession(sessionId);
};

export const disconnectSession = async (
  sessionId: string,
  companyId: string,
) => {
  const session = await requireSessionOwnedBy(sessionId, companyId);

  try {
    await wahaOrchestrator.logout(session.waha_session_id);
  } catch (err) {
    if (!isNotFoundError(err)) {
      console.warn("[whatsappService] logout falhou (segue removendo):", err);
    }
  }
  try {
    await wahaOrchestrator.remove(session.waha_session_id);
  } catch (err) {
    if (!isNotFoundError(err)) {
      console.warn("[whatsappService] remove falhou:", err);
    }
  }

  return prisma.whatsappSession.update({
    where: { id: session.id },
    data: {
      status: WhatsappSessionStatus.disconnected,
      is_active: false,
      updated_at: new Date(),
    },
  });
};

// Janela do lembrete de agendamento (horas antes). Limitada a 1h..7 dias.
export const updateReminderHours = async (companyId: string, hours: number) => {
  const h = Math.max(1, Math.min(168, Math.round(hours) || 24));
  return prisma.company.update({
    where: { id: companyId },
    data: { reminder_hours_before: h },
  });
};

export const sendSessionText = async (
  sessionId: string,
  companyId: string,
  chatId: string,
  text: string,
) => {
  const session = await requireSessionOwnedBy(sessionId, companyId);
  if (session.status !== WhatsappSessionStatus.authenticated) {
    const err: any = new Error("WhatsApp session is not connected");
    err.statusCode = 409;
    throw err;
  }
  return wahaOrchestrator.sendText(session.waha_session_id, chatId, text);
};
