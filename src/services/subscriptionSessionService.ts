import { prisma } from "../lib/prisma.js";
import { SessionStatus } from "@prisma/client";

const updateSubscriptionFromSessions = async (subscriptionId: string) => {
  const subscription = await prisma.clientSubscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    return;
  }

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.plan_id },
  });

  if (!plan || plan.plan_type !== "sessions" || !plan.total_sessions) {
    return;
  }

  const completedCount = await prisma.subscriptionSession.count({
    where: { subscription_id: subscriptionId, status: "completed" },
  });

  const sessionsRemaining = plan.total_sessions - completedCount;

  await prisma.clientSubscription.update({
    where: { id: subscriptionId },
    data: {
      sessions_used: completedCount,
      sessions_remaining: Math.max(0, sessionsRemaining),
      status: sessionsRemaining <= 0 ? "completed" : subscription.status,
      updated_at: new Date(),
    },
  });
};

export const getSubscriptionSessions = async (subscriptionId: string) => {
  return prisma.subscriptionSession.findMany({
    where: { subscription_id: subscriptionId },
    orderBy: { session_number: "asc" },
  });
};

export const createSubscriptionSession = async (data: any) => {
  return prisma.subscriptionSession.create({ data });
};

export const updateSubscriptionSession = async (
  sessionId: string,
  updates: any,
) => {
  const updated = await prisma.subscriptionSession.update({
    where: { id: sessionId },
    data: updates,
  });

  if (updates.status) {
    await updateSubscriptionFromSessions(updated.subscription_id);
  }

  return updated;
};

export const markSessionAsCompleted = async (
  sessionId: string,
  completedAt?: string,
) => {
  const updated = await prisma.subscriptionSession.update({
    where: { id: sessionId },
    data: {
      status: "completed",
      completed_at: completedAt ? new Date(completedAt) : new Date(),
    },
  });

  await updateSubscriptionFromSessions(updated.subscription_id);

  return updated;
};

export const scheduleSession = async (
  sessionId: string,
  scheduledDate: string,
  scheduledTime?: string,
) => {
  return prisma.subscriptionSession.update({
    where: { id: sessionId },
    data: {
      scheduled_date: new Date(scheduledDate),
      scheduled_time: scheduledTime || null,
      status: "scheduled",
    },
  });
};

export const getSessionsWithBookings = async (companyId: string) => {
  return prisma.subscriptionSession.findMany({
    where: { company_id: companyId, scheduled_date: { not: null } },
    include: {
      booking: true,
      attendant: { select: { id: true, name: true } },
      subscription: {
        include: {
          client: { select: { name: true, phone: true } },
          plan: { select: { name: true, plan_type: true } },
        },
      },
    },
    orderBy: { scheduled_date: "asc" },
  });
};

export const updateSessionStatus = async (
  sessionId: string,
  status: SessionStatus,
) => {
  const updated = await prisma.subscriptionSession.update({
    where: { id: sessionId },
    data: { status, updated_at: new Date() },
  });

  await updateSubscriptionFromSessions(updated.subscription_id);

  return updated;
};

export const archiveSession = async (sessionId: string) => {
  return prisma.subscriptionSession.update({
    where: { id: sessionId },
    data: { archived: true, updated_at: new Date() },
  });
};
