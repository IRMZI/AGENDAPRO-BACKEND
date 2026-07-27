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

/** Config de agenda no nível da empresa (granularidade da grade de horários). */
export const getSchedulingConfig = async (companyId: string) => {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { slot_interval_minutes: true },
  });
  return { slot_interval_minutes: company?.slot_interval_minutes ?? 30 };
};

export const updateSchedulingConfig = async (
  companyId: string,
  slotIntervalMinutes: number,
) => {
  // Clamp defensivo: 5–120 min.
  const value = Math.min(120, Math.max(5, Math.round(slotIntervalMinutes)));
  return prisma.company.update({
    where: { id: companyId },
    data: { slot_interval_minutes: value },
    select: { slot_interval_minutes: true },
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
