import { prisma } from "../lib/prisma.js";
import { SessionStatus } from "@prisma/client";

export const getClientSubscriptions = async (clientId: string) => {
  return prisma.clientSubscription.findMany({
    where: { client_id: clientId },
    include: {
      plan: {
        select: {
          name: true,
          plan_type: true,
          recurrence_type: true,
          total_sessions: true,
        },
      },
      client: { select: { name: true, phone: true } },
    },
    orderBy: { created_at: "desc" },
  });
};

export const getActiveSubscriptionsByCompanyId = async (companyId: string) => {
  return prisma.clientSubscription.findMany({
    where: { company_id: companyId, status: "active" },
    include: {
      plan: {
        select: {
          name: true,
          plan_type: true,
          recurrence_type: true,
          total_sessions: true,
        },
      },
      client: { select: { name: true, phone: true, email: true } },
    },
    orderBy: { next_booking_date: "asc" },
  });
};

export const createClientSubscription = async (data: any) => {
  const subscription = await prisma.clientSubscription.create({
    data: { ...data, sessions_used: 0 },
  });

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.plan_id },
  });

  if (plan?.plan_type === "sessions" && plan.total_sessions) {
    const sessions = Array.from({ length: plan.total_sessions }).map(
      (_, index) => ({
        subscription_id: subscription.id,
        company_id: subscription.company_id,
        session_number: index + 1,
        status: SessionStatus.scheduled,
      }),
    );

    if (sessions.length > 0) {
      await prisma.subscriptionSession.createMany({ data: sessions });
    }
  }

  return subscription;
};

export const updateClientSubscription = async (
  subscriptionId: string,
  updates: any,
) => {
  return prisma.clientSubscription.update({
    where: { id: subscriptionId },
    data: updates,
  });
};

export const processBookingCompletionWithSubscription = async (
  bookingId: string,
  subscriptionId: string,
) => {
  const subscription = await prisma.clientSubscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    return { success: false, error: "Subscription not found" };
  }

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.plan_id },
  });

  if (!plan) {
    return { success: false, error: "Plan not found" };
  }

  if (plan.plan_type === "sessions") {
    const updated = await prisma.clientSubscription.update({
      where: { id: subscriptionId },
      data: {
        sessions_remaining: Math.max(
          0,
          (subscription.sessions_remaining || 0) - 1,
        ),
        sessions_used: (subscription.sessions_used || 0) + 1,
        last_booking_date: (
          await prisma.booking.findUnique({ where: { id: bookingId } })
        )?.booking_date,
        status:
          subscription.sessions_remaining &&
          subscription.sessions_remaining - 1 <= 0
            ? "completed"
            : subscription.status,
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      sessions_remaining: updated.sessions_remaining,
      status: updated.status,
    };
  }

  if (plan.plan_type === "recurring") {
    const current = new Date();
    let nextDate = new Date(current);

    switch (plan.recurrence_type) {
      case "daily":
        nextDate.setDate(current.getDate() + (plan.recurrence_interval || 1));
        break;
      case "weekly":
        nextDate.setDate(
          current.getDate() + 7 * (plan.recurrence_interval || 1),
        );
        break;
      case "biweekly":
        nextDate.setDate(
          current.getDate() + 14 * (plan.recurrence_interval || 1),
        );
        break;
      case "monthly":
      default:
        nextDate.setMonth(current.getMonth() + (plan.recurrence_interval || 1));
        break;
    }

    const updated = await prisma.clientSubscription.update({
      where: { id: subscriptionId },
      data: {
        last_booking_date: (
          await prisma.booking.findUnique({ where: { id: bookingId } })
        )?.booking_date,
        next_booking_date: nextDate,
        updated_at: new Date(),
      },
    });

    return {
      success: true,
      next_booking_date: updated.next_booking_date,
      recurrence_type: plan.recurrence_type,
    };
  }

  return { success: true };
};

export const getSubscriptionSummary = async (subscriptionId: string) => {
  return prisma.clientSubscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: {
        select: {
          name: true,
          plan_type: true,
          recurrence_type: true,
          total_sessions: true,
        },
      },
      client: { select: { name: true, phone: true, email: true } },
    },
  });
};
