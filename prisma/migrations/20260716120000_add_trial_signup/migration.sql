-- Teste grátis de 7 dias originado da landing page.
--
-- subscription_status entra NOT NULL DEFAULT 'active' → TODA empresa existente
-- continua ativa; nenhuma vira 'trialing'/'expired' pelo backfill. O scheduler
-- só varre subscription_status='trialing', então o legado nunca é tocado.
-- (PG 11+: DEFAULT em ADD COLUMN é metadata-only, sem rewrite da tabela.)
ALTER TABLE "app_fd14ee28a1_companies"
  ADD COLUMN IF NOT EXISTS "subscription_status"   TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "trial_started_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trial_ends_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trial_warning_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signup_source"         TEXT,
  ADD COLUMN IF NOT EXISTS "signup_link_delivery"  TEXT,
  ADD COLUMN IF NOT EXISTS "signup_email_key"      TEXT,
  ADD COLUMN IF NOT EXISTS "signup_phone_key"      TEXT;

-- Anti-abuso: um email/telefone só ganha 7 dias grátis uma vez. NULL é DISTINTO
-- no Postgres, então empresas antigas (chave NULL) nunca conflitam entre si —
-- o índice vale só para cadastros vindos da landing. Índice único normal (e não
-- parcial) de propósito: parcial não é representável no schema Prisma e o
-- próximo `migrate diff` tentaria dropá-lo (drift).
CREATE UNIQUE INDEX IF NOT EXISTS "app_fd14ee28a1_companies_signup_email_key_key"
  ON "app_fd14ee28a1_companies"("signup_email_key");
CREATE UNIQUE INDEX IF NOT EXISTS "app_fd14ee28a1_companies_signup_phone_key_key"
  ON "app_fd14ee28a1_companies"("signup_phone_key");

-- Varredura do scheduler de trial.
CREATE INDEX IF NOT EXISTS "app_fd14ee28a1_companies_subscription_status_trial_ends_at_idx"
  ON "app_fd14ee28a1_companies"("subscription_status", "trial_ends_at");

-- Link mágico do dono (espelha Attendant.invite_token).
ALTER TABLE "app_fd14ee28a1_users"
  ADD COLUMN IF NOT EXISTS "setup_token"            TEXT,
  ADD COLUMN IF NOT EXISTS "setup_token_expires_at" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "app_fd14ee28a1_users_setup_token_key"
  ON "app_fd14ee28a1_users"("setup_token");

-- Empresa operadora (dona da sessão WhatsApp) que envia o onboarding do tenant,
-- + host do app por tenant (base do link mágico).
-- onboarding_company_id é coluna ESCALAR: sem relation no Prisma e SEM FK no
-- banco — Company.tenant_id → Tenant já existe e a volta criaria ciclo; uma FK
-- que existe no banco mas não no schema viraria drift no próximo migrate diff.
ALTER TABLE "app_fd14ee28a1_tenants"
  ADD COLUMN IF NOT EXISTS "onboarding_company_id" UUID,
  ADD COLUMN IF NOT EXISTS "app_url"               TEXT;
