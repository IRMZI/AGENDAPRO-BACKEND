import { prisma } from "../lib/prisma.js";

// Configurações padrão dos tenants (seedados no banco)
export const DEFAULT_TENANTS = {
  alignpro: {
    slug: "alignpro",
    name: "AlignPro",
    short_name: "AlignPro",
    tagline: "Agende seu alinhamento e balanceamento online",
    description:
      "Sistema de agendamento para oficinas mecânicas e centros automotivos",
    domains: [
      "dashboard-alignpro.com.br",
      "www.dashboard-alignpro.com.br",
      "alignpro.com.br",
      "www.alignpro.com.br",
    ],
    theme_primary: "217 91% 70%", // #659fff - Azul
    theme_secondary: "217 70% 60%", // Azul mais escuro
    theme_accent: "217 91% 70%", // Azul
    theme_background: "217 30% 96%", // Azul bem claro
    theme_foreground: "217 20% 25%", // Texto escuro azulado
    theme_card: "217 20% 98%", // Card azul claro
    theme_border: "217 10% 80%", // Bordas
    theme_muted: "217 15% 92%", // Elementos secundários
    theme_sidebar: "217 30% 96%", // Sidebar
    support_email: "contato@alignpro.com.br",
    website_url: "https://alignpro.com.br",
  },
  mbc: {
    slug: "mbc",
    name: "My Beauty Calendar",
    short_name: "MBC",
    tagline: "Sua rotina beauty, do jeitinho que sua rotina merece",
    description: "Sistema de agendamento para profissionais de beleza",
    domains: [
      "mybeautycalendar.com.br",
      "www.mybeautycalendar.com.br",
      "mbc.com.br",
      "www.mbc.com.br",
    ],
    theme_primary: "346 73% 80%", // Rosa médio #F3A6B8
    theme_secondary: "346 43% 73%", // Rosa escuro #E38CA4
    theme_accent: "346 73% 80%", // Rosa médio
    theme_background: "340 50% 96%", // Rosa suave #F9D0DA
    theme_foreground: "330 10% 32%", // Texto escuro #5A4A50
    theme_card: "330 30% 97%", // Card rosa claro #F8F1F3
    theme_border: "330 5% 75%", // Bordas #BFBCBD
    theme_muted: "330 15% 92%", // Elementos secundários
    theme_sidebar: "340 50% 96%", // Sidebar
    support_email: "contato@mybeautycalendar.com",
    website_url: "https://mybeautycalendar.com",
  },
};

export type TenantSlug = keyof typeof DEFAULT_TENANTS;

// Obter todos os tenants
export const getAllTenants = async () => {
  return prisma.tenant.findMany({
    where: { is_active: true },
    orderBy: { name: "asc" },
  });
};

// Obter tenant por slug
export const getTenantBySlug = async (slug: string) => {
  return prisma.tenant.findUnique({
    where: { slug },
  });
};

// Obter tenant por domínio
export const getTenantByDomain = async (domain: string) => {
  // Remove www. e normaliza o domínio
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  
  // Busca tenant que contenha o domínio (com ou sem www)
  const tenant = await prisma.tenant.findFirst({
    where: {
      is_active: true,
      OR: [
        { domains: { has: normalizedDomain } },
        { domains: { has: `www.${normalizedDomain}` } },
      ],
    },
  });
  
  return tenant;
};

// Obter tenant por ID
export const getTenantById = async (id: string) => {
  return prisma.tenant.findUnique({
    where: { id },
  });
};

// Criar tenant
export const createTenant = async (data: {
  slug: string;
  name: string;
  short_name?: string;
  tagline?: string;
  description?: string;
  theme_primary: string;
  theme_secondary?: string;
  theme_accent?: string;
  theme_background?: string;
  theme_foreground?: string;
  theme_card?: string;
  theme_border?: string;
  theme_muted?: string;
  theme_sidebar?: string;
  support_email?: string;
  support_phone?: string;
  website_url?: string;
  logo_url?: string;
  favicon_url?: string;
}) => {
  return prisma.tenant.create({ data });
};

// Atualizar tenant
export const updateTenant = async (
  id: string,
  data: Partial<{
    name: string;
    short_name: string;
    tagline: string;
    description: string;
    domains: string[];
    theme_primary: string;
    theme_secondary: string;
    theme_accent: string;
    theme_background: string;
    theme_foreground: string;
    theme_card: string;
    theme_border: string;
    theme_muted: string;
    theme_sidebar: string;
    support_email: string;
    support_phone: string;
    website_url: string;
    logo_url: string;
    favicon_url: string;
    is_active: boolean;
  }>,
) => {
  return prisma.tenant.update({
    where: { id },
    data: { ...data, updated_at: new Date() },
  });
};

// Deletar tenant
export const deleteTenant = async (id: string) => {
  return prisma.tenant.delete({ where: { id } });
};

// Seed inicial dos tenants padrão
export const seedDefaultTenants = async () => {
  const results = [];

  for (const [_, tenantData] of Object.entries(DEFAULT_TENANTS)) {
    const existing = await prisma.tenant.findUnique({
      where: { slug: tenantData.slug },
    });

    if (!existing) {
      const created = await prisma.tenant.create({
        data: tenantData,
      });
      results.push({ action: "created", tenant: created });
    } else {
      // Atualiza os domínios se já existir
      const updated = await prisma.tenant.update({
        where: { slug: tenantData.slug },
        data: { 
          domains: tenantData.domains,
          updated_at: new Date(),
        },
      });
      results.push({ action: "updated", tenant: updated });
    }
  }

  return results;
};

web: npm run start
