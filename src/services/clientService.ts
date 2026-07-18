import { prisma } from "../lib/prisma.js";
import { assertCompanyBookable } from "./companyService.js";

export const getClientsByCompanyId = async (companyId: string) => {
  return prisma.client.findMany({
    where: { company_id: companyId },
    orderBy: { name: "asc" },
  });
};

export const createClient = async (data: any) => {
  return prisma.client.create({ data });
};

export const upsertClient = async (data: any) => {
  return prisma.client.upsert({
    where: {
      company_id_phone: {
        company_id: data.company_id,
        phone: data.phone,
      },
    },
    update: data,
    create: data,
  });
};

export const upsertClientPublic = async (data: any) => {
  await assertCompanyBookable(data?.company_id);
  return upsertClient(data);
};

export const updateClient = async (clientId: string, updates: any) => {
  return prisma.client.update({
    where: { id: clientId },
    data: updates,
  });
};

export const deleteClient = async (clientId: string) => {
  return prisma.client.delete({
    where: { id: clientId },
  });
};

export const getClientBookings = async (clientId: string) => {
  return prisma.booking.findMany({
    where: { client_id: clientId },
    orderBy: [{ booking_date: "desc" }, { booking_time: "desc" }],
  });
};
