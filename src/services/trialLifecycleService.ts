import { prisma } from "../lib/prisma.js";
import { setCompanyAccess } from "./companyService.js";
import { sendAutomatedMessageToPhone } from "./whatsappChatService.js";
import { getBrandName } from "./tenantService.js";
import { TRIAL_DAYS, deliverSetupLink } from "./trialService.js";

// ============================================================================
// Ciclo de vida do teste grátis (tick do scheduler)
// ============================================================================
// Três tarefas por passada, todas idempotentes:
//   1. avisa 1 dia antes do fim      (uma vez, via trial_warning_sent_at)
//   2. expira + bloqueia o acesso    (compare-and-set em subscription_status)
//   3. reenvia link que falhou       (signup_link_delivery='failed')
//
// Só toca empresas com subscription_status='trialing' — nenhuma empresa legada
// (todas nasceram 'active' no backfill) entra nesta varredura.

const WARNING_WINDOW_MS = 24 * 60 * 60 * 1000;

const renderTpl = (
  body: string,
  vars: Record<string, string | null | undefined>,
) =>
  body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) =>
    (vars[k] ?? "").toString(),
  );

const DEFAULTS: Record<string, string> = {
  trial_warning:
    "Oi {{nome}}! Passando pra avisar que seu teste do {{marca}} termina amanhã ({{data}}).\n\n" +
    "Quer continuar com tudo funcionando? É só responder esta mensagem que a gente resolve. 💖",
  trial_expired:
    "Oi {{nome}}! Seu teste de {{dias}} dias do {{marca}} terminou hoje. 🥺\n\n" +
    "Sua agenda e seus dados estão guardadinhos. Responde aqui que a gente reativa seu acesso. 💖",
};

type TrialCompany = {
  id: string;
  name: string;
  phone: string;
  tenant_id: string | null;
  trial_ends_at: Date | null;
  trial_warning_sent_at: Date | null;
};

/**
 * Envia uma mensagem do ciclo de vida pela conexão do tenant. Nunca lança:
 * sendAutomatedMessageToPhone estoura se o orchestrator cair, e um tick que
 * morre no meio deixaria as empresas seguintes sem processar.
 */
const notify = async (
  company: TrialCompany,
  category: "trial_warning" | "trial_expired",
): Promise<boolean> => {
  if (!company.tenant_id || !company.phone) return false;
  const tenant = await prisma.tenant.findUnique({
    where: { id: company.tenant_id },
    select: { id: true, onboarding_company_id: true },
  });
  if (!tenant?.onboarding_company_id) return false;

  try {
    const tpl = await prisma.messageTemplate.findFirst({
      where: {
        company_id: tenant.onboarding_company_id,
        category,
        is_active: true,
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
    });
    const body = renderTpl(tpl?.body || DEFAULTS[category], {
      nome: (company.name || "").split(" ")[0] || "",
      marca: await getBrandName(company.tenant_id),
      dias: String(TRIAL_DAYS),
      data: company.trial_ends_at
        ? company.trial_ends_at.toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
          })
        : "",
    });
    const res = await sendAutomatedMessageToPhone(
      tenant.onboarding_company_id,
      company.phone,
      body,
      category,
    );
    if (!res.sent) {
      console.error(`[trial] ${category} não enviou (${company.id}): ${res.reason}`);
    }
    return res.sent;
  } catch (err: any) {
    console.error(`[trial] ${category} falhou (${company.id}):`, err?.message);
    return false;
  }
};

export const runTrialLifecycle = async (): Promise<{
  warned: number;
  expired: number;
  resent: number;
}> => {
  const now = new Date();
  let warned = 0;
  let expired = 0;
  let resent = 0;

  // ── 1. Aviso de "termina amanhã"
  // trial_ends_at > now é ESSENCIAL: sem isso, um backend que ficou 2 dias fora
  // acordaria e mandaria "termina amanhã" seguido de "terminou" na mesma passada.
  const toWarn = (await prisma.company.findMany({
    where: {
      subscription_status: "trialing",
      trial_warning_sent_at: null,
      trial_ends_at: {
        gt: now,
        lte: new Date(now.getTime() + WARNING_WINDOW_MS),
      },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      tenant_id: true,
      trial_ends_at: true,
      trial_warning_sent_at: true,
    },
    take: 200,
  })) as TrialCompany[];

  for (const company of toWarn) {
    const sent = await notify(company, "trial_warning");
    // Marca mesmo se não enviou: o aviso é "melhor esforço" e re-tentar todo
    // tick spammaria quem tem a conexão fora do ar. A expiração é o que importa.
    await prisma.company.update({
      where: { id: company.id },
      data: { trial_warning_sent_at: new Date() },
    });
    if (sent) warned++;
  }

  // ── 2. Expiração + bloqueio
  const toExpire = (await prisma.company.findMany({
    where: {
      subscription_status: "trialing",
      trial_ends_at: { not: null, lt: now },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      tenant_id: true,
      trial_ends_at: true,
      trial_warning_sent_at: true,
    },
    take: 200,
  })) as TrialCompany[];

  for (const company of toExpire) {
    // CAS: só expira se AINDA está 'trialing'. Diferente do lembrete de
    // agendamento, aqui existe escritor concorrente (operador reativando /
    // billing convertendo) — sem o guard a gente sobrescreveria a decisão dele.
    const ok = await setCompanyAccess(company.id, "expired", "trialing");
    if (!ok) continue;
    expired++;
    await notify(company, "trial_expired");
  }

  // ── 3. Retry do link de acesso que não foi entregue
  const toResend = await prisma.company.findMany({
    where: {
      subscription_status: "trialing",
      signup_link_delivery: "failed",
      trial_ends_at: { gt: now },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      tenant_id: true,
      trial_ends_at: true,
      user: { select: { setup_token: true } },
    },
    take: 50,
  });

  for (const company of toResend) {
    // Só re-entrega se o token ainda existe (não foi usado). Se a pessoa já
    // definiu a senha por outro caminho, não há o que reenviar.
    const token = company.user?.setup_token;
    if (!token || !company.tenant_id) continue;
    const tenant = await prisma.tenant.findUnique({
      where: { id: company.tenant_id },
      select: {
        id: true,
        slug: true,
        name: true,
        app_url: true,
        onboarding_company_id: true,
      },
    });
    if (!tenant) continue;

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
    if (delivery !== "failed") resent++;
  }

  return { warned, expired, resent };
};
