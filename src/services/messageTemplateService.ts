import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { isDefaultSenderCompany } from "./tenantService.js";

// Categorias suportadas. Hoje só "quick_reply" tem UI; as demais serão usadas
// pelas automações de agendamento / auto-resposta.
export const TEMPLATE_CATEGORIES = [
  "quick_reply",
  "greeting",
  "booking_confirmation", // legado (migrado p/ booking_status_pending)
  "booking_reminder",
  "auto_reply",
  // Automações por status do agendamento (disparam na mudança de status).
  "booking_status_pending",
  "booking_status_confirmed",
  "booking_status_in_progress",
  "booking_status_completed",
  "booking_status_cancelled",
  "booking_status_no_show",
  // Onboarding do teste grátis — SÓ a empresa remetente default customiza (ver
  // TRIAL_CATEGORIES). Vivem na empresa operadora; o resto do tempo o fluxo de
  // trial usa o texto padrão hardcoded do trialService.
  "trial_welcome",
  "trial_warning",
  "trial_expired",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// Categorias de onboarding do trial: gated à empresa de WhatsApp default.
export const TRIAL_CATEGORIES: readonly TemplateCategory[] = [
  "trial_welcome",
  "trial_warning",
  "trial_expired",
];

const normCategory = (c: unknown): TemplateCategory =>
  TEMPLATE_CATEGORIES.includes(c as TemplateCategory)
    ? (c as TemplateCategory)
    : "quick_reply";

// Trava as categorias de trial: só a conta de WhatsApp default do tenant pode
// criar/editar. Nas outras empresas seria dado morto (o fluxo de trial só lê os
// templates da operadora) — então recusamos com 403.
const assertMayUseCategory = async (
  companyId: string,
  category: TemplateCategory,
) => {
  if (!TRIAL_CATEGORIES.includes(category)) return;
  if (!(await isDefaultSenderCompany(companyId))) {
    const err: any = new Error(
      "As mensagens do teste grátis só podem ser editadas pela conta de WhatsApp padrão.",
    );
    err.statusCode = 403;
    throw err;
  }
};

export const listTemplates = async (companyId: string, category?: string) => {
  return prisma.messageTemplate.findMany({
    where: {
      company_id: companyId,
      is_active: true,
      ...(category ? { category } : {}),
    },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
  });
};

const requireOwned = async (id: string, companyId: string) => {
  const tpl = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!tpl || tpl.company_id !== companyId) {
    const err: any = new Error("Template não encontrado");
    err.statusCode = 404;
    throw err;
  }
  return tpl;
};

export const createTemplate = async (
  companyId: string,
  data: { title?: string; body?: string; category?: string; shortcut?: string; sort_order?: number },
) => {
  const title = data?.title?.trim();
  const body = data?.body;
  if (!title || !body || !body.trim()) {
    const err: any = new Error("title e body são obrigatórios");
    err.statusCode = 400;
    throw err;
  }
  const category = normCategory(data?.category);
  await assertMayUseCategory(companyId, category);
  return prisma.messageTemplate.create({
    data: {
      id: randomUUID(),
      company_id: companyId,
      category,
      title,
      body,
      shortcut: data?.shortcut?.trim() || null,
      sort_order: typeof data?.sort_order === "number" ? data.sort_order : 0,
    },
  });
};

export const updateTemplate = async (
  id: string,
  companyId: string,
  data: Record<string, unknown>,
) => {
  const existing = await requireOwned(id, companyId);
  // Gate se o template JÁ é de trial (editar texto/ativar) ou se está virando.
  await assertMayUseCategory(companyId, existing.category as TemplateCategory);
  if (data?.category !== undefined) {
    await assertMayUseCategory(companyId, normCategory(data.category));
  }
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (data?.title !== undefined) patch.title = String(data.title).trim();
  if (data?.body !== undefined) patch.body = String(data.body);
  if (data?.shortcut !== undefined)
    patch.shortcut = String(data.shortcut ?? "").trim() || null;
  if (data?.sort_order !== undefined)
    patch.sort_order = Number(data.sort_order) || 0;
  if (data?.is_active !== undefined) patch.is_active = Boolean(data.is_active);
  if (data?.category !== undefined) patch.category = normCategory(data.category);
  return prisma.messageTemplate.update({ where: { id }, data: patch });
};

export const deleteTemplate = async (id: string, companyId: string) => {
  await requireOwned(id, companyId);
  await prisma.messageTemplate.delete({ where: { id } });
  return { id };
};
