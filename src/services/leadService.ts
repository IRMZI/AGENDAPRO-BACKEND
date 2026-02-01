import { prisma } from "../lib/prisma.js";

export const createLead = async (data: any) => {
  return prisma.lead.create({ data });
};

export const getLeads = async () => {
  return prisma.lead.findMany({ orderBy: { created_at: "desc" } });
};
