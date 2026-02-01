import { prisma } from "../lib/prisma.js";

export const getServicesByCompanyId = async (companyId: string) => {
  return prisma.service.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { name: "asc" },
  });
};

export const createService = async (data: any) => {
  return prisma.service.create({
    data: { ...data, is_active: true },
  });
};

export const updateService = async (serviceId: string, data: any) => {
  return prisma.service.update({
    where: { id: serviceId },
    data: { ...data, updated_at: new Date() },
  });
};

export const deleteService = async (serviceId: string) => {
  return prisma.service.update({
    where: { id: serviceId },
    data: { is_active: false, updated_at: new Date() },
  });
};

export const getPlans = async () => {
  return prisma.plan.findMany({
    where: { is_active: true },
    orderBy: { price: "asc" },
  });
};

export const getPlanById = async (planId: string) => {
  return prisma.plan.findUnique({
    where: { id: planId },
  });
};
