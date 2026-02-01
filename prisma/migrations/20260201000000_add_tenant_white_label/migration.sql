-- CreateEnum
-- (Nenhum novo enum necessário)

-- CreateTable
CREATE TABLE "app_fd14ee28a1_tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "tagline" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "theme_primary" TEXT NOT NULL,
    "theme_secondary" TEXT,
    "theme_accent" TEXT,
    "theme_background" TEXT,
    "theme_foreground" TEXT,
    "theme_card" TEXT,
    "theme_border" TEXT,
    "theme_muted" TEXT,
    "theme_sidebar" TEXT,
    "support_email" TEXT,
    "support_phone" TEXT,
    "website_url" TEXT,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_tenants_slug_key" ON "app_fd14ee28a1_tenants"("slug");

-- AlterTable: Add tenant_id to companies
ALTER TABLE "app_fd14ee28a1_companies" ADD COLUMN "tenant_id" UUID;

-- AlterTable: Add tenant_id to preonboarding
ALTER TABLE "app_fd14ee28a1_preonboarding" ADD COLUMN "tenant_id" UUID;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_companies" ADD CONSTRAINT "app_fd14ee28a1_companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_fd14ee28a1_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_preonboarding" ADD CONSTRAINT "app_fd14ee28a1_preonboarding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "app_fd14ee28a1_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Insert default tenants
INSERT INTO "app_fd14ee28a1_tenants" (
    "slug",
    "name",
    "short_name",
    "tagline",
    "description",
    "theme_primary",
    "theme_secondary",
    "theme_accent",
    "theme_background",
    "theme_foreground",
    "theme_card",
    "theme_border",
    "theme_muted",
    "theme_sidebar",
    "support_email",
    "website_url"
) VALUES 
(
    'alignpro',
    'AlignPro',
    'AlignPro',
    'Agende seu alinhamento e balanceamento online',
    'Sistema de agendamento para oficinas mecânicas e centros automotivos',
    '217 91% 70%',
    '217 70% 60%',
    '217 91% 70%',
    '217 30% 96%',
    '217 20% 25%',
    '217 20% 98%',
    '217 10% 80%',
    '217 15% 92%',
    '217 30% 96%',
    'contato@alignpro.com.br',
    'https://alignpro.com.br'
),
(
    'mbc',
    'My Beauty Calendar',
    'MBC',
    'Sua rotina beauty, do jeitinho que sua rotina merece',
    'Sistema de agendamento para profissionais de beleza',
    '346 73% 80%',
    '346 43% 73%',
    '346 73% 80%',
    '340 50% 96%',
    '330 10% 32%',
    '330 30% 97%',
    '330 5% 75%',
    '330 15% 92%',
    '340 50% 96%',
    'contato@mybeautycalendar.com',
    'https://mybeautycalendar.com'
);
