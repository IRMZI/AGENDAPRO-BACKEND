import { prisma } from "../lib/prisma.js";

export const getAttendantLinks = async (attendantId: string) => {
  return prisma.attendantLink.findMany({
    where: { attendant_id: attendantId },
    orderBy: { display_order: "asc" },
  });
};

export const getAttendantLink = async (attendantId: string) => {
  return prisma.attendantLink.findFirst({
    where: { attendant_id: attendantId, is_active: true },
    orderBy: { display_order: "asc" },
  });
};

export const createAttendantLink = async (data: any) => {
  return prisma.attendantLink.create({ data });
};

export const updateAttendantLink = async (linkId: string, data: any) => {
  return prisma.attendantLink.update({
    where: { id: linkId },
    data: { ...data, updated_at: new Date() },
  });
};

export const deleteAttendantLink = async (linkId: string) => {
  return prisma.attendantLink.delete({ where: { id: linkId } });
};

export const upsertAttendantLink = async (data: any) => {
  return prisma.attendantLink.upsert({
    where: { attendant_id: data.attendant_id },
    update: { ...data, updated_at: new Date() },
    create: data,
  });
};

export const getAttendantBanner = async (attendantId: string) => {
  return prisma.attendantBanner.findFirst({
    where: { attendant_id: attendantId },
  });
};

export const createAttendantBanner = async (data: any) => {
  return prisma.attendantBanner.create({ data });
};

export const updateAttendantBanner = async (bannerId: string, data: any) => {
  return prisma.attendantBanner.update({
    where: { id: bannerId },
    data: { ...data, updated_at: new Date() },
  });
};

export const deleteAttendantBanner = async (bannerId: string) => {
  return prisma.attendantBanner.delete({ where: { id: bannerId } });
};

export const upsertAttendantBanner = async (data: any) => {
  return prisma.attendantBanner.upsert({
    where: { attendant_id: data.attendant_id },
    update: { ...data, updated_at: new Date() },
    create: data,
  });
};
