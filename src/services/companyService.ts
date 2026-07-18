import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// ============================================================================
// Acesso da empresa (assinatura no SaaS)
// ============================================================================
// Duas colunas, um significado. `subscription_status` é a fonte da verdade
// semântica; `is_active` é o flag mecânico que a superfície pública já checava
// antes deste módulo existir. Mantemos os dois em sincronia por UM lugar só
// (setCompanyAccess) para não drifitarem.
// Invariante: is_active=false + subscription_status='active' ≡ suspensão MANUAL
// do operador (diferente de trial expirado, que é 'expired').

export type CompanyAccessStatus =
  | "trialing"
  | "active"
  | "expired"
  | "blocked";

type AccessFields = { is_active: boolean; subscription_status: string };

/** Empresa pode operar/receber agendamento? Regra única, usada no guard e no público. */
export const isBookable = (c: AccessFields | null | undefined): boolean =>
  !!c && c.is_active && !["expired", "blocked"].includes(c.subscription_status);

/**
 * Erro da superfície pública com status HTTP embutido. "Empresa inativa" é um
 * estado ESPERADO, não falha de servidor — sem isto os controllers públicos
 * (que têm `catch → res.status(500)` fixo) devolveriam 500 para uma conta
 * simplesmente expirada.
 */
export class CompanyAccessError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "CompanyAccessError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Porta de entrada da superfície PÚBLICA (link de agendamento, slots, listas
 * públicas). Lança CompanyAccessError. Mantém o texto que bookingService/
 * clientService usavam, para não mudar o contrato de erro do agendamento.
 */
export const assertCompanyBookable = async (companyId: string | null | undefined) => {
  if (!companyId) {
    throw new CompanyAccessError("company_id is required", 400, "MISSING_COMPANY_ID");
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, is_active: true, subscription_status: true },
  });
  // Endpoint público: rejeita empresa inexistente (não deixa varrer ids).
  if (!company) {
    throw new CompanyAccessError("Company not found", 404, "COMPANY_NOT_FOUND");
  }
  if (!isBookable(company)) {
    throw new CompanyAccessError(
      "Company account is inactive. Please contact support.",
      403,
      "COMPANY_INACTIVE",
    );
  }
  return company;
};

// Cache curto do estado de acesso: o guard roda em ~toda rota autenticada e o
// dashboard dispara vários requests em paralelo — sem cache seria uma ida ao
// Neon por request. TTL baixo p/ reativação refletir rápido. Em processo, igual
// ao rateLimit (multi-instância cada um tem o seu; o TTL resolve a divergência).
type AccessEntry = AccessFields & { at: number };
const accessCache = new Map<string, AccessEntry>();
const ACCESS_TTL_MS = 30_000;

export const invalidateCompanyAccess = (companyId: string) => {
  accessCache.delete(companyId);
};

/** Leitura cacheada do acesso — usada pelo middleware requireActiveCompany. */
export const getCompanyAccessCached = async (
  companyId: string,
): Promise<AccessFields | null> => {
  const now = Date.now();
  const hit = accessCache.get(companyId);
  if (hit && now - hit.at < ACCESS_TTL_MS) return hit;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { is_active: true, subscription_status: true },
  });
  if (!company) return null;

  accessCache.set(companyId, { ...company, at: now });
  if (accessCache.size > 5_000) {
    for (const [k, v] of accessCache) {
      if (now - v.at >= ACCESS_TTL_MS) accessCache.delete(k);
    }
  }
  return company;
};

/**
 * ÚNICO ponto que escreve is_active + subscription_status. Compare-and-set
 * opcional (`expectedStatus`) para o scheduler não sobrescrever uma mudança
 * concorrente (operador/billing). Retorna false quando o CAS não casou.
 */
export const setCompanyAccess = async (
  companyId: string,
  status: CompanyAccessStatus,
  expectedStatus?: CompanyAccessStatus,
): Promise<boolean> => {
  const res = await prisma.company.updateMany({
    where: {
      id: companyId,
      ...(expectedStatus ? { subscription_status: expectedStatus } : {}),
    },
    data: {
      subscription_status: status,
      is_active: status === "trialing" || status === "active",
      updated_at: new Date(),
    },
  });
  // Sem isto, o bloqueio/reativação levaria até o TTL para valer no guard.
  invalidateCompanyAccess(companyId);
  return res.count === 1;
};

/**
 * Cria a empresa + a linha de permissões DENTRO de uma transação. Extraído para
 * que o cadastro self-service (trialService) não repita a lógica e para fechar
 * o buraco do caminho antigo: eram 2 writes soltos, e uma falha no segundo
 * deixava a empresa órfã, sem flags de módulo.
 */
export const createCompanyTx = async (
  tx: Prisma.TransactionClient,
  data: any,
) => {
  const company = await tx.company.create({
    data: {
      ...data,
      // is_active nunca vem do caller: quem manda no acesso é setCompanyAccess.
      is_active: true,
      updated_at: new Date(),
    },
  });
  // Every company gets a permissions row (module flags) with defaults.
  await tx.companyPermission.create({ data: { company_id: company.id } });
  return company;
};

export const createCompany = async (data: any) =>
  prisma.$transaction((tx) => createCompanyTx(tx, data));

export const getCompanyPermissions = async (companyId: string) => {
  return prisma.companyPermission.upsert({
    where: { company_id: companyId },
    create: { company_id: companyId },
    update: {},
  });
};

export const updateCompanyPermissions = async (
  companyId: string,
  data: {
    use_google_agenda?: boolean;
    use_financeiro?: boolean;
    use_conversation?: boolean;
  },
) => {
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (data.use_google_agenda !== undefined)
    patch.use_google_agenda = Boolean(data.use_google_agenda);
  if (data.use_financeiro !== undefined)
    patch.use_financeiro = Boolean(data.use_financeiro);
  if (data.use_conversation !== undefined)
    patch.use_conversation = Boolean(data.use_conversation);
  return prisma.companyPermission.upsert({
    where: { company_id: companyId },
    create: { company_id: companyId, ...patch },
    update: patch,
  });
};

export const getCompanyByUserId = async (userId: string) => {
  return prisma.company.findUnique({
    where: { user_id: userId },
  });
};

export const getCompanyById = async (companyId: string) => {
  return prisma.company.findUnique({
    where: { id: companyId },
  });
};

/**
 * Public-facing company lookup (no auth). Strips fields that must never be
 * exposed to anonymous callers: the owner's user_id, the unique company_token,
 * the internal primary_phone and todo o bloco de assinatura/cadastro (status do
 * trial e chaves de dedup não são da conta de quem abre o link de agendamento).
 * The booking pages only need name, contact, theme and banner data.
 *
 * Empresa bloqueada NÃO vira null de propósito: a página pública renderiza
 * "Empresa não encontrada" nesse caso, o que é enganoso e indistinguível de um
 * id errado. Devolvemos os dados + `is_bookable:false` p/ a UI dar o recado certo.
 */
export const getPublicCompanyById = async (companyId: string) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company) return null;
  const {
    user_id,
    company_token,
    primary_phone,
    subscription_status,
    trial_started_at,
    trial_ends_at,
    trial_warning_sent_at,
    signup_source,
    signup_link_delivery,
    signup_email_key,
    signup_phone_key,
    ...safe
  } = company;
  return { ...safe, is_bookable: isBookable(company) };
};

export const updateCompanyServices = async (
  companyId: string,
  services: string[],
) => {
  return prisma.company.update({
    where: { id: companyId },
    data: { services, updated_at: new Date() },
  });
};

export const updateCompany = async (companyId: string, updates: any) => {
  return prisma.company.update({
    where: { id: companyId },
    data: { ...updates, updated_at: new Date() },
  });
};

export const isCompanyActive = async (userId: string) => {
  const company = await getCompanyByUserId(userId);
  // Usa a MESMA regra do guard: trial expirado conta como inativo, senão o
  // Dashboard diria "tudo certo" enquanto a API devolve 402.
  return isBookable(company);
};
