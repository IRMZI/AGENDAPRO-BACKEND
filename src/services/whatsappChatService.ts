import { randomUUID } from "node:crypto";
import {
  ConversationType,
  MessageDirection,
  MessageStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { wahaOrchestrator } from "../lib/wahaOrchestrator.js";
import { emitToCompany } from "../lib/realtime.js";

// ============================================================
// Helpers de JID/parsing WAHA
// ============================================================

const isGroupJid = (jid: string) => jid.endsWith("@g.us");
const phoneFromJid = (jid: string) => jid.split("@")[0]?.split(":")[0] ?? "";

// Identifica a conversa: para inbound usamos `from`, para outbound `to`.
const resolveChatId = (payload: any): string => {
  if (typeof payload?.chatId === "string") return payload.chatId;
  if (payload?.fromMe && typeof payload?.to === "string") return payload.to;
  if (typeof payload?.from === "string") return payload.from;
  return "";
};

// Mapeia WAHA ack -> nosso MessageStatus
const ACK_TO_STATUS: Record<number, MessageStatus> = {
  0: MessageStatus.pending,
  1: MessageStatus.sent,
  2: MessageStatus.delivered,
  3: MessageStatus.read,
  4: MessageStatus.read,
};

// ============================================================
// Validar webhook (companyId via wahaSessionId)
// ============================================================

export const resolveSessionByWahaId = async (wahaSessionId: string) => {
  return prisma.whatsappSession.findFirst({
    where: { waha_session_id: wahaSessionId },
  });
};

// ============================================================
// Upserts (contact + conversation + message)
// ============================================================

const upsertContact = async (params: {
  companyId: string;
  sessionId: string;
  waId: string;
  pushName?: string | null;
}) => {
  const phone = phoneFromJid(params.waId);
  const existing = await prisma.whatsappContact.findUnique({
    where: {
      session_id_wa_id: { session_id: params.sessionId, wa_id: params.waId },
    },
  });
  if (existing) {
    if (params.pushName && params.pushName !== existing.push_name) {
      return prisma.whatsappContact.update({
        where: { id: existing.id },
        data: { push_name: params.pushName, updated_at: new Date() },
      });
    }
    return existing;
  }
  const contact = await prisma.whatsappContact.create({
    data: {
      id: randomUUID(),
      company_id: params.companyId,
      session_id: params.sessionId,
      wa_id: params.waId,
      push_name: params.pushName ?? null,
      phone,
    },
  });
  // Lazy: tenta pegar profile pic em background, sem bloquear o evento
  void syncContactProfilePic(contact.id, params.sessionId, params.waId).catch(
    (err) =>
      console.warn("[whatsappChat] profile pic sync falhou:", err?.message),
  );
  return contact;
};

const syncContactProfilePic = async (
  contactId: string,
  sessionId: string,
  waId: string,
) => {
  const session = await prisma.whatsappSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return;
  try {
    const res = await wahaOrchestrator.getProfilePic(
      session.waha_session_id,
      waId,
    );
    if (res?.url) {
      await prisma.whatsappContact.update({
        where: { id: contactId },
        data: { profile_pic_url: res.url, updated_at: new Date() },
      });
    }
  } catch {
    // 404 ou sem foto — ok
  }
};

const upsertConversation = async (params: {
  companyId: string;
  sessionId: string;
  chatId: string;
  contactId?: string;
}) => {
  const type = isGroupJid(params.chatId)
    ? ConversationType.group
    : ConversationType.individual;
  const existing = await prisma.whatsappConversation.findUnique({
    where: {
      session_id_wa_chat_id: {
        session_id: params.sessionId,
        wa_chat_id: params.chatId,
      },
    },
  });
  if (existing) return existing;
  return prisma.whatsappConversation.create({
    data: {
      id: randomUUID(),
      company_id: params.companyId,
      session_id: params.sessionId,
      type,
      wa_chat_id: params.chatId,
      contact_id: params.contactId ?? null,
    },
  });
};

// ============================================================
// Event handlers
// ============================================================

interface WahaMessagePayload {
  id?: string;
  timestamp?: number;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  type?: string;
  ack?: number;
  ackName?: string;
  _data?: {
    notifyName?: string;
    quotedMessage?: any;
  };
  notifyName?: string;
  media?: {
    url?: string | null;
    mimetype?: string | null;
    filename?: string | null;
  } | null;
  reply_to?: any;
  replyTo?: any;
  quotedMsg?: any;
  reaction?: {
    text?: string;
    messageId?: string;
  };
}

const extractReplyMeta = (payload: WahaMessagePayload) => {
  const candidates = [
    payload.reply_to,
    payload.replyTo,
    payload.quotedMsg,
    payload._data?.quotedMessage,
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  const q = candidates[0];
  const id = q.id?._serialized || q.id || q.messageId;
  if (!id) return null;
  return {
    messageId: typeof id === "string" ? id : String(id),
    body: q.body ?? q.text ?? null,
    from: q.from ?? null,
  };
};

const handleIncomingMessage = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) {
    console.warn(`[whatsappChat] webhook para session desconhecida: ${wahaSessionId}`);
    return;
  }
  if (!payload.id) return;

  const chatId = resolveChatId(payload);
  if (!chatId) return;

  const direction = payload.fromMe
    ? MessageDirection.outbound
    : MessageDirection.inbound;
  const status =
    typeof payload.ack === "number"
      ? (ACK_TO_STATUS[payload.ack] ?? MessageStatus.sent)
      : direction === MessageDirection.outbound
        ? MessageStatus.sent
        : MessageStatus.delivered;

  const contactWaId = payload.fromMe ? payload.to : payload.from;
  let contactId: string | undefined;
  if (contactWaId && !isGroupJid(contactWaId)) {
    const contact = await upsertContact({
      companyId: session.company_id,
      sessionId: session.id,
      waId: contactWaId,
      pushName: payload.notifyName ?? payload._data?.notifyName ?? null,
    });
    contactId = contact.id;
  }

  const conversation = await upsertConversation({
    companyId: session.company_id,
    sessionId: session.id,
    chatId,
    contactId,
  });

  const ts = payload.timestamp
    ? new Date(payload.timestamp * 1000)
    : new Date();

  // Idempotencia via @@unique([session_id, wa_message_id])
  const exists = await prisma.whatsappMessage.findUnique({
    where: {
      session_id_wa_message_id: {
        session_id: session.id,
        wa_message_id: payload.id,
      },
    },
  });
  if (exists) {
    if (exists.status !== status) {
      await prisma.whatsappMessage.update({
        where: { id: exists.id },
        data: { status, updated_at: new Date() },
      });
    }
    return;
  }

  // Reconciliacao: se for outbound e tivermos uma row "local-..." recente
  // da mesma conv com o mesmo body, atualiza ela em vez de criar nova.
  if (direction === MessageDirection.outbound) {
    const since = new Date(Date.now() - 5 * 60 * 1000); // 5min
    const placeholder = await prisma.whatsappMessage.findFirst({
      where: {
        session_id: session.id,
        conversation_id: conversation.id,
        direction: MessageDirection.outbound,
        wa_message_id: { startsWith: "local-" },
        body: payload.body ?? null,
        created_at: { gte: since },
      },
      orderBy: { created_at: "desc" },
    });
    if (placeholder) {
      await prisma.whatsappMessage.update({
        where: { id: placeholder.id },
        data: {
          wa_message_id: payload.id,
          status,
          timestamp: ts,
          raw_data: payload as any,
          updated_at: new Date(),
        },
      });
      return;
    }
  }

  const replyMeta = extractReplyMeta(payload);
  const rawWithMeta: any = { ...payload };
  if (replyMeta) rawWithMeta._replyTo = replyMeta;

  const created = await prisma.whatsappMessage.create({
    data: {
      id: randomUUID(),
      company_id: session.company_id,
      session_id: session.id,
      conversation_id: conversation.id,
      wa_message_id: payload.id,
      direction,
      status,
      from_number: payload.from ? phoneFromJid(payload.from) : null,
      to_number: payload.to ? phoneFromJid(payload.to) : null,
      body: payload.body ?? null,
      media_type: payload.type && payload.type !== "chat" ? payload.type : null,
      media_url: payload.media?.url ?? null,
      media_mime_type: payload.media?.mimetype ?? null,
      timestamp: ts,
      raw_data: rawWithMeta,
    },
  });

  const updatedConv = await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      last_message: payload.body?.slice(0, 200) ?? "[mídia]",
      last_message_at: ts,
      unread_count:
        direction === MessageDirection.inbound
          ? { increment: 1 }
          : conversation.unread_count,
      updated_at: new Date(),
    },
  });

  emitToCompany(session.company_id, "message:new", {
    conversationId: conversation.id,
    message: created,
  });
  emitToCompany(session.company_id, "conversation:updated", {
    conversation: updatedConv,
  });
};

// ============================================================
// Reaction handler (evento message.reaction)
// ============================================================

const handleReactionEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const targetId = payload.reaction?.messageId ?? payload.id;
  const emoji = payload.reaction?.text ?? "";
  if (!targetId) return;

  const target = await prisma.whatsappMessage.findFirst({
    where: { session_id: session.id, wa_message_id: targetId },
  });
  if (!target) return;

  const raw = (target.raw_data as any) ?? {};
  const reactions: any[] = Array.isArray(raw._reactions) ? raw._reactions : [];
  const reactorWaId = payload.fromMe ? payload.to : payload.from;
  const idx = reactions.findIndex((r) => r.from === reactorWaId);
  if (emoji) {
    const entry = {
      from: reactorWaId,
      emoji,
      timestamp: payload.timestamp ?? Date.now() / 1000,
    };
    if (idx >= 0) reactions[idx] = entry;
    else reactions.push(entry);
  } else if (idx >= 0) {
    // emoji vazio -> removeu reacao
    reactions.splice(idx, 1);
  }

  const updated = await prisma.whatsappMessage.update({
    where: { id: target.id },
    data: {
      raw_data: { ...raw, _reactions: reactions },
      updated_at: new Date(),
    },
  });

  emitToCompany(session.company_id, "message:updated", {
    conversationId: target.conversation_id,
    message: updated,
  });
};

const handleAckEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session || !payload.id || typeof payload.ack !== "number") return;
  const status = ACK_TO_STATUS[payload.ack] ?? MessageStatus.sent;
  const before = await prisma.whatsappMessage.findFirst({
    where: { session_id: session.id, wa_message_id: payload.id },
  });
  if (!before) return;
  const updated = await prisma.whatsappMessage.update({
    where: { id: before.id },
    data: { status, updated_at: new Date() },
  });
  emitToCompany(session.company_id, "message:updated", {
    conversationId: updated.conversation_id,
    message: updated,
  });
};

// ============================================================
// Typing indicator (presence.update)
// ============================================================

const handlePresenceEvent = async (
  wahaSessionId: string,
  payload: any,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const chatId = payload?.id ?? payload?.from ?? payload?.chatId;
  if (!chatId) return;
  const conv = await prisma.whatsappConversation.findUnique({
    where: {
      session_id_wa_chat_id: {
        session_id: session.id,
        wa_chat_id: chatId,
      },
    },
  });
  if (!conv) return;
  const presences: any[] = Array.isArray(payload?.presences)
    ? payload.presences
    : [{ presence: payload?.presence }];
  const typing = presences.some(
    (p) => p?.presence === "composing" || p?.presence === "typing",
  );
  emitToCompany(session.company_id, "typing", {
    conversationId: conv.id,
    typing,
  });
};

// ============================================================
// Entry point
// ============================================================

export const processWebhookEvent = async (
  wahaSessionId: string,
  event: unknown,
) => {
  if (!event || typeof event !== "object") return;
  const e = event as { event?: string; payload?: any };
  switch (e.event) {
    case "message":
    case "message.any":
      if (e.payload) {
        // Se o payload eh uma reacao (vem dentro de "message" as vezes)
        if (e.payload.reaction) {
          await handleReactionEvent(wahaSessionId, e.payload);
        } else {
          await handleIncomingMessage(wahaSessionId, e.payload);
        }
      }
      break;
    case "message.ack":
      if (e.payload) await handleAckEvent(wahaSessionId, e.payload);
      break;
    case "message.reaction":
      if (e.payload) await handleReactionEvent(wahaSessionId, e.payload);
      break;
    case "presence.update":
    case "presence":
      if (e.payload) await handlePresenceEvent(wahaSessionId, e.payload);
      break;
    default:
      break;
  }
};

// ============================================================
// Chat REST API
// ============================================================

// Normaliza para os ultimos 10 digitos (ddd + numero) p/ comparar telefones
const normalizeDigits = (s: string | null | undefined) =>
  s ? s.replace(/\D/g, "").slice(-10) : "";

interface LinkedClientPreview {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

const buildClientPhoneMap = async (companyId: string) => {
  const clients = await prisma.client.findMany({
    where: { company_id: companyId },
    select: { id: true, name: true, phone: true, email: true },
  });
  const map = new Map<string, LinkedClientPreview>();
  for (const c of clients) {
    const key = normalizeDigits(c.phone);
    if (!key) continue;
    if (!map.has(key)) map.set(key, c);
  }
  return map;
};

export const listConversations = async (
  companyId: string,
  sessionId?: string,
) => {
  const [rows, clientMap] = await Promise.all([
    prisma.whatsappConversation.findMany({
      where: {
        company_id: companyId,
        ...(sessionId ? { session_id: sessionId } : {}),
      },
      orderBy: [{ last_message_at: "desc" }, { created_at: "desc" }],
      include: {
        contact: {
          select: {
            id: true,
            wa_id: true,
            name: true,
            push_name: true,
            phone: true,
            profile_pic_url: true,
          },
        },
        group: {
          select: { id: true, name: true, profile_pic_url: true },
        },
        session: { select: { id: true, name: true, phone_number: true } },
      },
      take: 100,
    }),
    buildClientPhoneMap(companyId),
  ]);

  return rows.map((row) => {
    const phoneKey = normalizeDigits(
      row.contact?.phone ?? row.wa_chat_id.split("@")[0],
    );
    const linkedClient = phoneKey ? (clientMap.get(phoneKey) ?? null) : null;
    return { ...row, linkedClient };
  });
};

// ============================================================
// CRM bridge: criar cliente a partir do contato da conversa
// ============================================================

export const createClientFromConversation = async (
  convId: string,
  companyId: string,
  overrides?: { name?: string; email?: string },
) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: { contact: true },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  if (conv.type === "group") {
    const err: any = new Error("Cannot create client from group conversation");
    err.statusCode = 400;
    throw err;
  }

  const phone = conv.contact?.phone ?? phoneFromJid(conv.wa_chat_id);
  if (!phone) {
    const err: any = new Error("No phone available on conversation");
    err.statusCode = 400;
    throw err;
  }

  const name =
    overrides?.name?.trim() ||
    conv.contact?.push_name ||
    conv.contact?.name ||
    `Cliente WhatsApp ${phone}`;

  // Idempotente: se ja existe cliente com mesmo phone na company, retorna
  const existing = await prisma.client.findFirst({
    where: { company_id: companyId, phone },
  });
  if (existing) return existing;

  return prisma.client.create({
    data: {
      company_id: companyId,
      name,
      phone,
      email: overrides?.email ?? null,
    },
  });
};

const requireConversation = async (convId: string, companyId: string) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: { session: true },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  return conv;
};

export const listMessages = async (
  convId: string,
  companyId: string,
  options: { limit?: number; before?: string } = {},
) => {
  await requireConversation(convId, companyId);
  const limit = Math.min(options.limit ?? 50, 200);
  return prisma.whatsappMessage.findMany({
    where: {
      conversation_id: convId,
      ...(options.before ? { timestamp: { lt: new Date(options.before) } } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
};

export const sendConversationMessage = async (
  convId: string,
  companyId: string,
  body: string,
  replyToWaMessageId?: string,
) => {
  const conv = await requireConversation(convId, companyId);

  // Se reply, busca a msg citada pra anexar preview
  let replyMeta: any = null;
  if (replyToWaMessageId) {
    const quoted = await prisma.whatsappMessage.findFirst({
      where: {
        session_id: conv.session_id,
        wa_message_id: replyToWaMessageId,
      },
    });
    if (quoted) {
      replyMeta = {
        messageId: replyToWaMessageId,
        body: quoted.body,
        from: quoted.from_number,
      };
    }
  }

  await wahaOrchestrator.sendText(
    conv.session.waha_session_id,
    conv.wa_chat_id,
    body,
    replyToWaMessageId,
  );

  const now = new Date();
  const rawData: any = {};
  if (replyMeta) rawData._replyTo = replyMeta;

  const message = await prisma.whatsappMessage.create({
    data: {
      id: randomUUID(),
      company_id: companyId,
      session_id: conv.session_id,
      conversation_id: conv.id,
      wa_message_id: `local-${randomUUID()}`,
      direction: MessageDirection.outbound,
      status: MessageStatus.pending,
      to_number: phoneFromJid(conv.wa_chat_id),
      body,
      timestamp: now,
      raw_data: rawData,
    },
  });

  const updatedConv = await prisma.whatsappConversation.update({
    where: { id: conv.id },
    data: {
      last_message: body.slice(0, 200),
      last_message_at: now,
      updated_at: now,
    },
  });

  emitToCompany(companyId, "message:new", {
    conversationId: conv.id,
    message,
  });
  emitToCompany(companyId, "conversation:updated", {
    conversation: updatedConv,
  });

  return message;
};

// ============================================================
// React / Mark seen
// ============================================================

export const reactToMessage = async (
  convId: string,
  companyId: string,
  waMessageId: string,
  emoji: string,
) => {
  const conv = await requireConversation(convId, companyId);
  await wahaOrchestrator.sendReaction(
    conv.session.waha_session_id,
    conv.wa_chat_id,
    waMessageId,
    emoji,
  );
  // O webhook chega depois e atualiza raw_data._reactions
  return { ok: true };
};

export const sendChatSeen = async (convId: string, companyId: string) => {
  const conv = await requireConversation(convId, companyId);
  try {
    await wahaOrchestrator.sendSeen(
      conv.session.waha_session_id,
      conv.wa_chat_id,
    );
  } catch {
    // ignore — falha de sendSeen nao deve quebrar UX
  }
};

export const markConversationSeen = async (
  convId: string,
  companyId: string,
) => {
  const conv = await requireConversation(convId, companyId);
  // Manda sendSeen pro WhatsApp em background
  void sendChatSeen(convId, companyId).catch(() => undefined);
  if (conv.unread_count === 0) return conv;
  const updated = await prisma.whatsappConversation.update({
    where: { id: conv.id },
    data: { unread_count: 0, updated_at: new Date() },
  });
  emitToCompany(companyId, "conversation:updated", { conversation: updated });
  return updated;
};
