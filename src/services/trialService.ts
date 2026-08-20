import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isValidBrMobile, normalizeDigits } from "../lib/phone.js";
import { createCompanyTx } from "./companyService.js";
import { sendAutomatedMessageToPhone } from "./whatsappChatService.js";
import { sendEmail } from "./emailService.js";
import { getBrandName } from "./tenantService.js";
import { issueHandoffForUser } from "./authService.js";
import { verifyGoogleCredential } from "./googleAuthService.js";
import { startEmailVerification } from "./emailVerificationService.js";
import { notifyContactApi } from "./contactApiService.js";

// ============================================================================
// Cadastro self-service do teste grátis (landing page → company com 7 dias)
// ============================================================================
// Fluxo: valida → grava o Lead → cria User+Company numa transação → manda o
// link mágico por WhatsApp a partir da conexão do TENANT (empresa operadora).
//
// Anti-abuso: um email/telefone só ganha 7 dias uma vez. Duas camadas, ambas
// necessárias — o SELECT pré-voo cobre o escopo semântico (empresa criada pelo
// fluxo manual, que tem Company.email mas signup_*_key NULL) e os índices
// únicos cobrem a CORRIDA (duplo submit), que um check-then-insert não pega.

export const TRIAL_DAYS = 7;

export class TrialError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "TrialError";
    this.status = status;
    this.code = code;
  }
}

const ALREADY_USED_MSG =
  "Este e-mail ou telefone já utilizou o teste grátis. Se a conta é sua, é só entrar.";

export type TrialSignupInput = {
  name?: string;
  email?: string;
  whatsapp?: string;
  business_name?: string;
  segment?: string;
  team_size?: string;
  instagram?: string;
  auth_provider?: string;
  tenant_slug?: string;
  utm?: Record<string, string>;
  password?: string;
  email_code?: string;
  google_credential?: string;
};

const emailKeyOf = (email: string) => email.trim().toLowerCase();

// "Só eu" / "2 a 3" / "4 ou mais" → tamanho + teto de atendentes do plano.
const teamSizeToCompany = (teamSize?: string) => {
  switch ((teamSize || "").trim()) {
    case "2 a 3":
      return { company_size: "SMALL" as const, max_attendants: 3 };
    case "4 ou mais":
      return { company_size: "MID" as const, max_attendants: 10 };
    default:
      return { company_size: "MEI" as const, max_attendants: 1 };
  }
};

const buildSetupUrl = (appUrl: string | null | undefined, token: string) => {
  const base = (appUrl || process.env.FRONTEND_URL || "http://localhost:5173")
    .replace(/\/$/, "");
  return `${base}/definir-senha/${token}`;
};

const renderTpl = (
  body: string,
  vars: Record<string, string | null | undefined>,
) =>
  body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) =>
    (vars[k] ?? "").toString(),
  );

// Mensagens padrão. Ao contrário das automações de agendamento (onde "sem
// template ativo" = opt-out, não envia), aqui o template é só customização:
// sem ele o cadastro NÃO pode ficar sem link de acesso. Fallback obrigatório.
const DEFAULT_BODIES: Record<string, string> = {
  trial_welcome:
    "Oi {{nome}}! 💖 Seu teste de {{dias}} dias do {{marca}} está liberado.\n\n" +
    "Toque aqui para criar sua senha e entrar:\n{{link}}\n\n" +
    "Qualquer dúvida é só responder esta mensagem. 😉",
  trial_warning:
    "Oi {{nome}}! Passando pra avisar que seu teste do {{marca}} termina amanhã ({{data}}).\n\n" +
    "Quer continuar com tudo funcionando? É só responder esta mensagem que a gente resolve. 💖",
  trial_expired:
    "Oi {{nome}}! Seu teste de {{dias}} dias do {{marca}} terminou hoje. 🥺\n\n" +
    "Sua agenda e seus dados estão guardadinhos. Responde aqui que a gente reativa seu acesso. 💖",
};

const resolveBody = async (
  operatorCompanyId: string,
  category: keyof typeof DEFAULT_BODIES,
  vars: Record<string, string>,
) => {
  const tpl = await prisma.messageTemplate.findFirst({
    where: { company_id: operatorCompanyId, category, is_active: true },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
  });
  return renderTpl(tpl?.body || DEFAULT_BODIES[category], vars);
};

type TenantLite = {
  id: string;
  slug: string;
  name: string;
  app_url: string | null;
  onboarding_company_id: string | null;
};

const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  app_url: true,
  onboarding_company_id: true,
} as const;

const resolveTenant = async (slug?: string): Promise<TenantLite | null> =>
  prisma.tenant.findUnique({
    where: { slug: slug || "mbc" },
    select: TENANT_SELECT,
  });

/**
 * Entrega o link mágico. WhatsApp é o canal primário DE PROPÓSITO: só quem
 * controla o número recebe o link, o que verifica o telefone implicitamente —
 * exatamente o anti-abuso pedido. Por isso o link nunca volta na resposta HTTP.
 * Nunca lança: falha de entrega não pode derrubar um cadastro já commitado
 * (a company existiria sem ninguém conseguir entrar). Retorna o canal usado.
 */
export const deliverSetupLink = async (opts: {
  tenant: TenantLite;
  companyId: string;
  ownerName: string;
  email: string;
  phone: string;
  token: string;
  category: keyof typeof DEFAULT_BODIES;
}): Promise<"whatsapp" | "email" | "failed"> => {
  const { tenant, companyId, ownerName, email, phone, token, category } = opts;
  const brand = await getBrandName(tenant.id);
  const link = buildSetupUrl(tenant.app_url, token);
  const vars = {
    nome: (ownerName || "").split(" ")[0] || "",
    link,
    dias: String(TRIAL_DAYS),
    marca: brand,
    data: "",
  };

  if (tenant.onboarding_company_id) {
    try {
      const body = await resolveBody(tenant.onboarding_company_id, category, vars);
      const res = await sendAutomatedMessageToPhone(
        tenant.onboarding_company_id,
        phone,
        body,
        category,
      );
      if (res.sent) return "whatsapp";
      console.error(
        `[trial] WhatsApp não enviou (company=${companyId}): ${res.reason}`,
      );
    } catch (err: any) {
      // sendAutomatedMessageToPhone LANÇA se o orchestrator cair — sem este
      // catch o signup daria 500 depois de commitar e a pessoa ficaria presa
      // no dedup, com uma conta que não consegue acessar.
      console.error(
        `[trial] WhatsApp falhou (company=${companyId}):`,
        err?.message,
      );
    }
  } else {
    console.error(
      `[trial] tenant "${tenant.name}" sem onboarding_company_id — nenhum WhatsApp será enviado`,
    );
  }

  // Fallback: email. sendEmail LANÇA quando SMTP não está configurado.
  try {
    await sendEmail({
      to: email,
      subject: `Seu teste de ${TRIAL_DAYS} dias — ${brand}`,
      type: "attendant_invite",
      data: {
        brand_name: brand,
        attendant_name: ownerName,
        company_name: brand,
        invite_url: link,
      },
    });
    return "email";
  } catch (err: any) {
    console.error(`[trial] email falhou (company=${companyId}):`, err?.message);
    return "failed";
  }
};

// ── Helpers compartilhados (cadastro manual + Google) ───────────────────────

const buildEntrarUrl = (appUrl: string | null | undefined, code: string) => {
  const base = (appUrl || process.env.FRONTEND_URL || "http://localhost:5173")
    .replace(/\/$/, "");
  return `${base}/entrar?code=${encodeURIComponent(code)}`;
};

type LeadInfo = {
  name: string;
  email: string;
  whatsapp: string;
  segment?: string;
  business_name: string;
  team_size?: string;
  instagram?: string;
  auth_provider: string;
  tenant_slug: string;
  utm?: Record<string, string>;
  max_attendants: number;
};

// Lead SEMPRE, inclusive quando o cadastro é recusado — "tentou de novo" é sinal
// de marketing e o Lead não tem constraint que possa falhar.
const recordTrialLead = (info: LeadInfo, outcome: string) =>
  prisma.lead
    .create({
      data: {
        name: info.name,
        email: info.email,
        phone: info.whatsapp,
        business_type: info.segment || "não informado",
        attendants_count: info.max_attendants,
        source_message: JSON.stringify({
          outcome,
          business_name: info.business_name,
          team_size: info.team_size ?? null,
          instagram: info.instagram ?? null,
          auth_provider: info.auth_provider,
          tenant: info.tenant_slug,
          utm: info.utm ?? {},
        }).slice(0, 4000),
      },
    })
    .catch((err) => console.error("[trial] falha ao gravar lead:", err?.message));

/**
 * Dedup em 2 partes: SELECT semântico (pega quem já tem conta, inclusive as do
 * fluxo manual/pre-onboarding sem signup_*_key) + scan de telefone das empresas
 * antigas (phone é texto livre, não casa no banco). A CORRIDA (duplo submit) é
 * pega pelo índice único no create (P2002). Email case-insensitive nos 2 lados.
 */
const findTrialDuplicate = async (emailKey: string, phoneKey: string) => {
  const [existingUser, existingCompany] = await Promise.all([
    prisma.user.findFirst({
      where: { email: { equals: emailKey, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.company.findFirst({
      where: {
        OR: [
          { signup_email_key: emailKey },
          { signup_phone_key: phoneKey },
          { email: { equals: emailKey, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (existingUser || existingCompany) return true;

  const withPhone = await prisma.company.findMany({
    where: { signup_phone_key: null, NOT: { phone: "" } },
    select: { id: true, phone: true },
  });
  return withPhone.some((c) => normalizeDigits(c.phone) === phoneKey);
};

/** Pré-voo público: barra email/telefone já usado ANTES de mandar o código. */
export const assertTrialIdentityAvailable = async (
  email: string,
  whatsapp: string,
) => {
  if (await findTrialDuplicate(emailKeyOf(email), normalizeDigits(whatsapp))) {
    throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
  }
};

/**
 * Núcleo de criação do teste (User + Company numa transação). Acesso é imediato
 * agora — sem setup_token/link mágico. `passwordHash` é a senha real (manual) ou
 * uma inutilizável (Google, que loga pelo próprio Google). P2002 na corrida.
 */
const createTrialAccount = async (opts: {
  tenant: TenantLite;
  email: string;
  emailKey: string;
  whatsapp: string;
  phoneKey: string;
  businessName: string;
  segment?: string;
  teamSize?: string;
  passwordHash: string;
}) => {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const { company_size, max_attendants } = teamSizeToCompany(opts.teamSize);

  const company = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: opts.emailKey, password_hash: opts.passwordHash },
    });
    return createCompanyTx(tx, {
      user_id: user.id,
      tenant_id: opts.tenant.id,
      name: opts.businessName,
      company_nickname: opts.businessName,
      email: opts.email,
      phone: opts.whatsapp,
      business_type: opts.segment || null,
      company_size,
      max_attendants,
      subscription_status: "trialing",
      trial_started_at: now,
      trial_ends_at: trialEndsAt,
      signup_source: "landing_trial",
      signup_email_key: opts.emailKey,
      signup_phone_key: opts.phoneKey,
      // Marca o novo fluxo de acesso imediato (antes: whatsapp/email/failed).
      signup_link_delivery: "instant",
    });
  });
  return { company, trialEndsAt };
};

/**
 * Cadastro manual (email + senha). Exige verificação de email por código
 * (assertEmailVerified) e devolve um handoff que loga a pessoa no app. Lança
 * TrialError / EmailVerificationError em caso de recusa.
 */
export const signupTrial = async (input: TrialSignupInput) => {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim();
  const whatsapp = (input.whatsapp || "").trim();
  const businessName = (input.business_name || "").trim();
  const password = input.password || "";

  if (name.length < 2) throw new TrialError("Informe seu nome.", 400, "INVALID_NAME");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    throw new TrialError("E-mail inválido.", 400, "INVALID_EMAIL");
  if (!isValidBrMobile(whatsapp))
    throw new TrialError(
      "Informe um celular válido com DDD (com WhatsApp ativo).",
      400,
      "INVALID_PHONE",
    );
  if (businessName.length < 2)
    throw new TrialError("Informe o nome do seu negócio.", 400, "INVALID_BUSINESS");
  if (password.length < 6)
    throw new TrialError(
      "A senha deve ter pelo menos 6 caracteres.",
      400,
      "INVALID_PASSWORD",
    );

  const tenant = await resolveTenant(input.tenant_slug);
  if (!tenant) throw new TrialError("Origem inválida.", 400, "INVALID_TENANT");

  const emailKey = emailKeyOf(email);
  const phoneKey = normalizeDigits(whatsapp);
  const lead: LeadInfo = {
    name,
    email,
    whatsapp,
    segment: input.segment,
    business_name: businessName,
    team_size: input.team_size,
    instagram: input.instagram,
    auth_provider: input.auth_provider || "manual",
    tenant_slug: tenant.slug ?? input.tenant_slug ?? "mbc",
    utm: input.utm,
    max_attendants: teamSizeToCompany(input.team_size).max_attendants,
  };

  if (await findTrialDuplicate(emailKey, phoneKey)) {
    await recordTrialLead(lead, "rejected_duplicate");
    throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let created: Awaited<ReturnType<typeof createTrialAccount>>;
  try {
    created = await createTrialAccount({
      tenant,
      email,
      emailKey,
      whatsapp,
      phoneKey,
      businessName,
      segment: input.segment,
      teamSize: input.team_size,
      passwordHash,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await recordTrialLead(lead, "rejected_duplicate_race");
      throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
    }
    throw err;
  }

  await recordTrialLead(lead, "created");
  // Fire-and-forget: avisa o contact-api externo com os dados do lead. Não
  // bloqueia nem derruba o cadastro (trata erro internamente).
  void notifyContactApi({
    name,
    whatsapp,
    email,
    business_name: businessName,
    segment: input.segment,
    team_size: input.team_size,
    instagram: input.instagram,
  });

  const handoffCode = await issueHandoffForUser(created.company.user_id);
  return {
    company_id: created.company.id,
    trial_ends_at: created.trialEndsAt,
    handoff_code: handoffCode,
    redirect_url: buildEntrarUrl(tenant.app_url, handoffCode),
  };
};

/**
 * Cadastro/login via Google. Verifica o ID token server-side. Email já tem conta
 * → loga direto (handoff), sem pedir o funil de novo. Conta nova mas sem
 * negócio/whatsapp ainda → { needs_profile } para o funil seguir (nada é criado).
 * Com os dados → cria o teste e devolve handoff. Google é verificado por
 * natureza, então NÃO passa por código de email.
 */
export const signupTrialWithGoogle = async (input: TrialSignupInput) => {
  const identity = await verifyGoogleCredential(input.google_credential || "");
  if (!identity.emailVerified) {
    throw new TrialError(
      "Sua conta Google está sem e-mail verificado.",
      400,
      "GOOGLE_EMAIL_UNVERIFIED",
    );
  }

  const tenant = await resolveTenant(input.tenant_slug);
  if (!tenant) throw new TrialError("Origem inválida.", 400, "INVALID_TENANT");

  const email = identity.email;
  const emailKey = emailKeyOf(email);
  const name = (input.name || identity.name || "").trim();
  const whatsapp = (input.whatsapp || "").trim();
  const businessName = (input.business_name || "").trim();

  // Usuário que volta: loga direto.
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: emailKey, mode: "insensitive" } },
    select: { id: true },
  });
  if (existingUser) {
    const handoffCode = await issueHandoffForUser(existingUser.id);
    return {
      returning: true,
      company_id: null,
      trial_ends_at: null,
      handoff_code: handoffCode,
      redirect_url: buildEntrarUrl(tenant.app_url, handoffCode),
    };
  }

  // Conta nova, mas o funil ainda não coletou negócio/whatsapp: sinaliza p/ o
  // front prefilar nome/email e seguir. Nada é criado ainda.
  if (businessName.length < 2 || !whatsapp) {
    return {
      needs_profile: true as const,
      prefill: { name: identity.name || "", email },
    };
  }

  if (!isValidBrMobile(whatsapp))
    throw new TrialError(
      "Informe um celular válido com DDD (com WhatsApp ativo).",
      400,
      "INVALID_PHONE",
    );

  const phoneKey = normalizeDigits(whatsapp);
  const lead: LeadInfo = {
    name,
    email,
    whatsapp,
    segment: input.segment,
    business_name: businessName,
    team_size: input.team_size,
    instagram: input.instagram,
    auth_provider: "google",
    tenant_slug: tenant.slug ?? input.tenant_slug ?? "mbc",
    utm: input.utm,
    max_attendants: teamSizeToCompany(input.team_size).max_attendants,
  };

  if (await findTrialDuplicate(emailKey, phoneKey)) {
    await recordTrialLead(lead, "rejected_duplicate");
    throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
  }

  // Google-user: senha inutilizável (login futuro é pelo próprio Google).
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  let created: Awaited<ReturnType<typeof createTrialAccount>>;
  try {
    created = await createTrialAccount({
      tenant,
      email,
      emailKey,
      whatsapp,
      phoneKey,
      businessName,
      segment: input.segment,
      teamSize: input.team_size,
      passwordHash,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await recordTrialLead(lead, "rejected_duplicate_race");
      throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
    }
    throw err;
  }

  await recordTrialLead(lead, "created");
  void notifyContactApi({
    name,
    whatsapp,
    email,
    business_name: businessName,
    segment: input.segment,
    team_size: input.team_size,
    instagram: input.instagram,
  });

  const handoffCode = await issueHandoffForUser(created.company.user_id);
  return {
    returning: false,
    company_id: created.company.id,
    trial_ends_at: created.trialEndsAt,
    handoff_code: handoffCode,
    redirect_url: buildEntrarUrl(tenant.app_url, handoffCode),
  };
};

/**
 * Passo 1 do cadastro manual: valida disponibilidade (dedup) e manda o código
 * de verificação no email. Falha ANTES de gastar um código se o email/telefone
 * já usou o teste.
 */
export const startTrialVerification = async (input: {
  email?: string;
  whatsapp?: string;
  tenant_slug?: string;
}) => {
  const email = (input.email || "").trim();
  const whatsapp = (input.whatsapp || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    throw new TrialError("E-mail inválido.", 400, "INVALID_EMAIL");
  if (!isValidBrMobile(whatsapp))
    throw new TrialError(
      "Informe um celular válido com DDD (com WhatsApp ativo).",
      400,
      "INVALID_PHONE",
    );

  const tenant = await resolveTenant(input.tenant_slug);
  if (!tenant) throw new TrialError("Origem inválida.", 400, "INVALID_TENANT");

  await assertTrialIdentityAvailable(email, whatsapp);

  const brand = await getBrandName(tenant.id);
  await startEmailVerification(email, brand);
};

/**
 * Reenvia o link de acesso. Recuperação para "o WhatsApp não chegou" e para o
 * token queimado/expirado. Resposta é sempre genérica no controller — não pode
 * virar oráculo de enumeração de contas.
 */
export const resendSetupLink = async (identifier: string) => {
  const raw = (identifier || "").trim();
  if (!raw) return;

  const isEmail = raw.includes("@");
  const company = await prisma.company.findFirst({
    where: isEmail
      ? { signup_email_key: emailKeyOf(raw) }
      : { signup_phone_key: normalizeDigits(raw) },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      tenant_id: true,
      subscription_status: true,
      trial_ends_at: true,
      user: { select: { id: true, password_hash: true } },
    },
  });

  // Só reenvia p/ teste vivo. Conta expirada/ativa entra pelo login normal.
  if (!company || company.subscription_status !== "trialing") return;
  if (company.trial_ends_at && company.trial_ends_at < new Date()) return;

  const tenant = company.tenant_id
    ? await prisma.tenant.findUnique({
        where: { id: company.tenant_id },
        select: TENANT_SELECT,
      })
    : null;
  if (!tenant) return;

  const token = randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: company.user.id },
    data: {
      setup_token: token,
      setup_token_expires_at: company.trial_ends_at ?? new Date(Date.now() + 864e5),
      updated_at: new Date(),
    },
  });

  const delivery = await deliverSetupLink({
    tenant,
    companyId: company.id,
    ownerName: company.name,
    email: company.email,
    phone: company.phone,
    token,
    category: "trial_welcome",
  });

  await prisma.company.update({
    where: { id: company.id },
    data: { signup_link_delivery: delivery, updated_at: new Date() },
  });
};

/** Estado do teste p/ a tela de "expirado" (rota isenta do guard). */
export const getTrialStatus = async (companyId: string) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      is_active: true,
      subscription_status: true,
      trial_started_at: true,
      trial_ends_at: true,
    },
  });
  if (!company) return null;

  const now = Date.now();
  const endsAt = company.trial_ends_at?.getTime() ?? null;
  return {
    company_id: company.id,
    subscription_status: company.subscription_status,
    is_active: company.is_active,
    trial_ends_at: company.trial_ends_at,
    days_left:
      endsAt && company.subscription_status === "trialing"
        ? Math.max(0, Math.ceil((endsAt - now) / 864e5))
        : 0,
  };
};
