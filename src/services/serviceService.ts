import { prisma } from "../lib/prisma.js";
import { assertCompanyBookable } from "./companyService.js";

// Sincroniza os atendentes vinculados a um serviço (M2M). undefined = não mexe.
const syncServiceAttendants = async (
  serviceId: string,
  attendantIds?: string[],
) => {
  if (!Array.isArray(attendantIds)) return;
  const ids = [...new Set(attendantIds.filter(Boolean))];
  await prisma.serviceAttendant.deleteMany({ where: { service_id: serviceId } });
  if (ids.length > 0) {
    await prisma.serviceAttendant.createMany({
      data: ids.map((attendant_id) => ({ service_id: serviceId, attendant_id })),
      skipDuplicates: true,
    });
  }
};

export const getServicesByCompanyId = async (companyId: string) => {
  const rows = await prisma.service.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { name: "asc" },
    include: { serviceAttendants: { select: { attendant_id: true } } },
  });
  return rows.map(({ serviceAttendants, ...s }) => ({
    ...s,
    attendant_ids: serviceAttendants.map((sa) => sa.attendant_id),
  }));
};

/**
 * Public-facing service list (no auth) used by the booking pages. Returns only
 * display-safe fields; keeps attendant_ids so the page can filter which
 * services a given attendant offers.
 */
export const getPublicServicesByCompanyId = async (companyId: string) => {
  await assertCompanyBookable(companyId);
  const rows = await prisma.service.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      company_id: true,
      name: true,
      description: true,
      duration_minutes: true,
      price: true,
      image_url: true,
      serviceAttendants: { select: { attendant_id: true } },
    },
  });
  return rows.map(({ serviceAttendants, ...s }) => ({
    ...s,
    attendant_ids: serviceAttendants.map((sa) => sa.attendant_id),
  }));
};

export const createService = async (data: any) => {
  const { attendant_ids, ...rest } = data ?? {};
  const created = await prisma.service.create({
    data: { ...rest, is_active: true },
  });
  await syncServiceAttendants(created.id, attendant_ids);
  return created;
};

export const updateService = async (serviceId: string, data: any) => {
  const { attendant_ids, ...rest } = data ?? {};
  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: { ...rest, updated_at: new Date() },
  });
  await syncServiceAttendants(serviceId, attendant_ids);
  return updated;
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
