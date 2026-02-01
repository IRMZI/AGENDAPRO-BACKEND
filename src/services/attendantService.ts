import { prisma } from "../lib/prisma.js";

export const getAttendantsByCompanyId = async (companyId: string) => {
  return prisma.attendant.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { name: "asc" },
  });
};

export const createAttendant = async (data: any) => {
  return prisma.attendant.create({
    data: { ...data, is_active: true },
  });
};

export const updateAttendant = async (attendantId: string, data: any) => {
  return prisma.attendant.update({
    where: { id: attendantId },
    data: { ...data, updated_at: new Date() },
  });
};

export const deleteAttendant = async (attendantId: string) => {
  return prisma.attendant.update({
    where: { id: attendantId },
    data: { is_active: false, updated_at: new Date() },
  });
};

export const getAttendantByUsername = async (
  companyId: string,
  username: string,
) => {
  return prisma.attendant.findFirst({
    where: { company_id: companyId, username },
  });
};
