import { prisma } from "../lib/prisma.js";

export const createCompany = async (data: any) => {
  const company = await prisma.company.create({
    data: {
      ...data,
      is_active: true,
      updated_at: new Date(),
    },
  });
  // Every company gets a permissions row (module flags) with defaults.
  await prisma.companyPermission.create({
    data: { company_id: company.id },
  });
  return company;
};

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
 * exposed to anonymous callers: the owner's user_id, the unique company_token
 * and the internal primary_phone. The booking pages only need name, contact,
 * theme and banner data.
 */
export const getPublicCompanyById = async (companyId: string) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company) return null;
  const { user_id, company_token, primary_phone, ...safe } = company;
  return safe;
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
  return company?.is_active === true;
};
