import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const checkPreOnboardingToken = async (token: string) => {
  const record = await prisma.preOnboarding.findUnique({
    where: { company_token: token },
  });

  if (!record) {
    return {
      exists: false,
      available: false,
      message: "Token não encontrado",
    };
  }

  const isUsed = record.is_used || record.status === "completed";

  if (isUsed) {
    return {
      exists: true,
      available: false,
      message: "Token já utilizado",
    };
  }

  return {
    exists: true,
    available: true,
    message: "Token disponível",
  };
};

export const usePreOnboardingToken = async (token: string, userId: string) => {
  const now = new Date();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const record = await tx.preOnboarding.findUnique({
      where: { company_token: token },
    });

    if (!record || record.is_used || record.status === "completed") {
      return {
        success: false,
        error: "Token inválido ou já utilizado",
      };
    }

    const updated = await tx.preOnboarding.update({
      where: { company_token: token },
      data: {
        is_used: true,
        used_at: now,
        used_by_user_id: userId,
        status: "completed",
        completed_at: now,
        updated_at: now,
      },
    });

    return {
      success: true,
      data: updated,
    };
  });
};

export const getPreOnboardingByToken = async (token: string) => {
  return prisma.preOnboarding.findFirst({
    where: { company_token: token, is_used: false },
  });
};

export const getAllPreOnboardings = async () => {
  return prisma.preOnboarding.findMany({
    orderBy: { created_at: "desc" },
  });
};

export const createPreOnboarding = async (data: any) => {
  return prisma.preOnboarding.create({ data });
};

export const updatePreOnboarding = async (id: string, data: any) => {
  return prisma.preOnboarding.update({
    where: { id },
    data,
  });
};

export const deletePreOnboarding = async (id: string) => {
  return prisma.preOnboarding.delete({ where: { id } });
};
