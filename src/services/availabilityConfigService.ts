import { prisma } from "../lib/prisma.js";

export const getCompanyBusinessHours = async (companyId: string) => {
  return prisma.companyBusinessHours.findMany({
    where: { company_id: companyId },
    orderBy: { weekday: "asc" },
  });
};

export const upsertCompanyBusinessHours = async (data: any) => {
  return prisma.companyBusinessHours.upsert({
    where: {
      company_id_weekday: {
        company_id: data.company_id,
        weekday: data.weekday,
      },
    },
    update: { ...data, updated_at: new Date() },
    create: data,
  });
};

export const getAttendantWeekdays = async (attendantId: string) => {
  return prisma.attendantWeekday.findMany({
    where: { attendant_id: attendantId },
    orderBy: { weekday: "asc" },
  });
};

export const upsertAttendantWeekday = async (data: any) => {
  return prisma.attendantWeekday.upsert({
    where: {
      attendant_id_weekday: {
        attendant_id: data.attendant_id,
        weekday: data.weekday,
      },
    },
    update: { ...data, updated_at: new Date() },
    create: data,
  });
};
