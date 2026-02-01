import { prisma } from "../lib/prisma.js";

export const getServicePlansByCompanyId = async (companyId: string) => {
  return prisma.plan.findMany({
    where: { company_id: companyId, is_active: true },
    include: {
      service: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
};

export const createServicePlan = async (data: any) => {
  return prisma.plan.create({ data });
};

export const updateServicePlan = async (planId: string, updates: any) => {
  return prisma.plan.update({
    where: { id: planId },
    data: updates,
  });
};

export const deleteServicePlan = async (planId: string) => {
  return prisma.plan.update({
    where: { id: planId },
    data: { is_active: false },
  });
};
