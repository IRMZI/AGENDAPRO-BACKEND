import { prisma } from "../lib/prisma.js";

export const createCompany = async (data: any) => {
  return prisma.company.create({
    data: {
      ...data,
      is_active: true,
      updated_at: new Date(),
    },
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
