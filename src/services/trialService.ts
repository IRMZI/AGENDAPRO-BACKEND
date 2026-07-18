import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isValidBrMobile, normalizeDigits } from "../lib/phone.js";
import { createCompanyTx } from "./companyService.js";
import { sendAutomatedMessageToPhone } from "./whatsappChatService.js";
import { sendEmail } from "./emailService.js";
import { getBrandName } from "./tenantService.js";

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

/** Cadastro do teste grátis. Lança TrialError (409/400) em caso de recusa. */
export const signupTrial = async (input: TrialSignupInput) => {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim();
  const whatsapp = (input.whatsapp || "").trim();
  const businessName = (input.business_name || "").trim();

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

  const tenant = await resolveTenant(input.tenant_slug);
  if (!tenant) throw new TrialError("Origem inválida.", 400, "INVALID_TENANT");

  const emailKey = emailKeyOf(email);
  const phoneKey = normalizeDigits(whatsapp);
  const { company_size, max_attendants } = teamSizeToCompany(input.team_size);

  // Lead SEMPRE, inclusive quando o cadastro é recusado — "tentou de novo" é
  // sinal de marketing e o Lead não tem constraint que possa falhar.
  const recordLead = (outcome: string) =>
    prisma.lead
      .create({
        data: {
          name,
          email,
          phone: whatsapp,
          business_type: input.segment || "não informado",
          attendants_count: max_attendants,
          source_message: JSON.stringify({
            outcome,
            business_name: businessName,
            team_size: input.team_size ?? null,
            instagram: input.instagram ?? null,
            auth_provider: input.auth_provider ?? null,
            tenant: tenant.slug ?? input.tenant_slug ?? "mbc",
            utm: input.utm ?? {},
          }).slice(0, 4000),
        },
      })
      .catch((err) => console.error("[trial] falha ao gravar lead:", err?.message));

  // Camada 1 (semântica): pega quem JÁ tem conta — inclusive as criadas pelo
  // fluxo manual/pre-onboarding, que não têm signup_*_key preenchida.
  // Email comparado case-insensitive nos dois lados: User.email é @unique mas o
  // cadastro antigo gravava como digitado, então findUnique(lowercase) erraria.
  const [existingUser, existingCompany] = await Promise.all([
    prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.company.findFirst({
      where: {
        OR: [
          { signup_email_key: emailKey },
          { signup_phone_key: phoneKey },
          { email: { equals: email, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (existingUser || existingCompany) {
    await recordLead("rejected_duplicate");
    throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
  }

  // Telefone das empresas ANTIGAS: `phone` é texto livre (o cadastro manual
  // grava "(51) 98027-6600"), então não dá pra casar no banco — normaliza em
  // memória. A base de empresas é pequena (dezenas); se crescer, popular
  // signup_phone_key no cadastro manual também e cair fora deste scan.
  const withPhone = await prisma.company.findMany({
    where: { signup_phone_key: null, NOT: { phone: "" } },
    select: { id: true, phone: true },
  });
  if (withPhone.some((c) => normalizeDigits(c.phone) === phoneKey)) {
    await recordLead("rejected_duplicate_phone");
    throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
  }

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("hex");

  let company: { id: string };
  try {
    company = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: emailKey,
          // Senha inutilizável: o acesso é pelo link mágico (setup_token).
          password_hash: await bcrypt.hash(randomUUID(), 10),
          setup_token: token,
          // TTL casado com o fim do teste: um token que morre no dia 3 enquanto
          // o teste queima até o dia 7 só gera chamado de suporte.
          setup_token_expires_at: trialEndsAt,
        },
      });

      return createCompanyTx(tx, {
        user_id: user.id,
        tenant_id: tenant.id,
        name: businessName,
        company_nickname: businessName,
        email,
        phone: whatsapp,
        business_type: input.segment || null,
        company_size,
        max_attendants,
        subscription_status: "trialing",
        trial_started_at: now,
        trial_ends_at: trialEndsAt,
        signup_source: "landing_trial",
        signup_email_key: emailKey,
        signup_phone_key: phoneKey,
      });
    });
  } catch (err: any) {
    // Camada 2 (corrida): dois submits simultâneos — o índice único decide.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await recordLead("rejected_duplicate_race");
      throw new TrialError(ALREADY_USED_MSG, 409, "TRIAL_ALREADY_USED");
    }
    throw err;
  }

  await recordLead("created");

  // Pós-commit: a entrega NUNCA desfaz o cadastro. Se falhar, o teste existe,
  // o dedup vale, e o link se recupera por /trial/resend-link ou pelo scheduler.
  const delivery = await deliverSetupLink({
    tenant,
    companyId: company.id,
    ownerName: name,
    email,
    phone: whatsapp,
    token,
    category: "trial_welcome",
  });

  await prisma.company.update({
    where: { id: company.id },
    data: { signup_link_delivery: delivery, updated_at: new Date() },
  });

  return {
    company_id: company.id,
    trial_ends_at: trialEndsAt,
    delivery,
  };
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
