import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : Number(d);

const dayStart = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const dayEnd = (s: string) => new Date(`${s.slice(0, 10)}T23:59:59.999Z`);

/* ════════════════════════════════════════════════════════════════
   Revenue + commission capture (Phase 2 + 3) — called inside the
   booking-completion transaction. Idempotent via unique booking_id.
   ════════════════════════════════════════════════════════════════ */

async function computeBookingGross(
  tx: Tx,
  bookingId: string,
  providedTotal?: Prisma.Decimal | number | null,
): Promise<number> {
  if (providedTotal != null) return round2(num(providedTotal));

  const items = await tx.bookingService.findMany({
    where: { booking_id: bookingId },
    include: { service: { select: { price: true } } },
  });
  if (items.length > 0) {
    return round2(
      items.reduce(
        (s, it) => s + num(it.price_snapshot ?? it.service?.price),
        0,
      ),
    );
  }
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { service_rel: { select: { price: true } } },
  });
  return round2(num(booking?.service_rel?.price));
}

export async function recordBookingFinancials(
  tx: Tx,
  booking: {
    id: string;
    company_id: string;
    attendant_id: string | null;
    total_amount: Prisma.Decimal | number | null;
    payment_method: any;
    booking_date: Date | null;
    client_name?: string | null;
    service?: string | null;
  },
) {
  const gross = await computeBookingGross(tx, booking.id, booking.total_amount);

  // Description links the ledger entry back to the appointment.
  const description = [
    "Atendimento",
    booking.client_name ? `· ${booking.client_name}` : "",
    booking.service ? `(${booking.service})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  await tx.financialTransaction.upsert({
    where: { booking_id: booking.id },
    create: {
      company_id: booking.company_id,
      type: "income",
      source: "booking",
      category: "service",
      description,
      amount: gross,
      payment_method: booking.payment_method ?? null,
      occurred_at: booking.booking_date ?? new Date(),
      booking_id: booking.id,
      attendant_id: booking.attendant_id ?? null,
    },
    update: {
      amount: gross,
      description,
      payment_method: booking.payment_method ?? null,
    },
  });

  if (booking.attendant_id) {
    const att = await tx.attendant.findUnique({
      where: { id: booking.attendant_id },
      select: { commission_enabled: true, commission_percent: true },
    });
    if (
      att?.commission_enabled &&
      att.commission_percent != null &&
      num(att.commission_percent) > 0
    ) {
      const percent = num(att.commission_percent);
      const amount = round2((gross * percent) / 100);
      await tx.commission.upsert({
        where: { booking_id: booking.id },
        create: {
          company_id: booking.company_id,
          attendant_id: booking.attendant_id,
          booking_id: booking.id,
          base_amount: gross,
          percent,
          amount,
          status: "pending",
        },
        // Don't rewrite history if re-completed; percent is snapshotted.
        update: {},
      });
    }
  }
  return gross;
}

/** Subscription payment → income (idempotent by subscription_id + source). */
export async function recordSubscriptionIncome(subscriptionId: string) {
  const sub = await prisma.clientSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, company_id: true, amount_paid: true },
  });
  if (!sub) return;
  const existing = await prisma.financialTransaction.findFirst({
    where: { subscription_id: sub.id, source: "subscription" },
    select: { id: true },
  });
  if (existing) return;
  await prisma.financialTransaction.create({
    data: {
      company_id: sub.company_id,
      type: "income",
      source: "subscription",
      category: "subscription",
      amount: round2(num(sub.amount_paid)),
      occurred_at: new Date(),
      subscription_id: sub.id,
    },
  });
}

/* ════════════════════════════════════════════════════════════════
   Reports & summary (Phase 2 + 4)
   ════════════════════════════════════════════════════════════════ */

export async function getFinancialSummary(
  companyId: string,
  start?: string,
  end?: string,
) {
  const dateFilter =
    start && end ? { occurred_at: { gte: dayStart(start), lte: dayEnd(end) } } : {};

  const [incomeAgg, expenseAgg, commissionAgg, pendingAgg] = await Promise.all([
    prisma.financialTransaction.aggregate({
      _sum: { amount: true },
      where: { company_id: companyId, type: "income", ...dateFilter },
    }),
    prisma.financialTransaction.aggregate({
      _sum: { amount: true },
      // Exclude commission-payout expenses — commissions are accounted for
      // separately below, so counting them here would double-subtract.
      where: {
        company_id: companyId,
        type: "expense",
        OR: [{ category: null }, { category: { not: "commission" } }],
        ...dateFilter,
      },
    }),
    prisma.commission.aggregate({
      _sum: { amount: true },
      where: {
        company_id: companyId,
        status: { not: "cancelled" },
        ...(start && end
          ? { created_at: { gte: dayStart(start), lte: dayEnd(end) } }
          : {}),
      },
    }),
    prisma.commission.aggregate({
      _sum: { amount: true },
      where: { company_id: companyId, status: "pending" },
    }),
  ]);

  const revenue = round2(num(incomeAgg._sum.amount));
  const expenses = round2(num(expenseAgg._sum.amount));
  const commissions = round2(num(commissionAgg._sum.amount));
  const commissionsPending = round2(num(pendingAgg._sum.amount));

  return {
    revenue,
    expenses,
    commissions,
    commissionsPending,
    profit: round2(revenue - expenses - commissions),
  };
}

export async function getRevenueSeries(
  companyId: string,
  start: string,
  end: string,
) {
  const rows = await prisma.financialTransaction.findMany({
    where: {
      company_id: companyId,
      occurred_at: { gte: dayStart(start), lte: dayEnd(end) },
    },
    select: { type: true, amount: true, occurred_at: true },
    orderBy: { occurred_at: "asc" },
  });
  const map = new Map<string, { date: string; income: number; expense: number }>();
  for (const r of rows) {
    const key = r.occurred_at.toISOString().slice(0, 10);
    const entry = map.get(key) ?? { date: key, income: 0, expense: 0 };
    if (r.type === "income") entry.income = round2(entry.income + num(r.amount));
    else entry.expense = round2(entry.expense + num(r.amount));
    map.set(key, entry);
  }
  return Array.from(map.values());
}

/* ════════════════════════════════════════════════════════════════
   Transactions / expenses (Phase 4)
   ════════════════════════════════════════════════════════════════ */

export async function listTransactions(
  companyId: string,
  opts: { type?: "income" | "expense"; start?: string; end?: string } = {},
) {
  return prisma.financialTransaction.findMany({
    where: {
      company_id: companyId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.start && opts.end
        ? { occurred_at: { gte: dayStart(opts.start), lte: dayEnd(opts.end) } }
        : {}),
    },
    orderBy: { occurred_at: "desc" },
    take: 500,
  });
}

export async function createTransaction(
  companyId: string,
  data: {
    type: "income" | "expense";
    category?: string;
    description?: string;
    amount: number;
    payment_method?: any;
    occurred_at?: string;
    created_by?: string;
  },
) {
  const amount = round2(Number(data.amount));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Valor inválido");
  }
  return prisma.financialTransaction.create({
    data: {
      company_id: companyId,
      type: data.type,
      source: "manual",
      category: data.category || null,
      description: data.description || null,
      amount,
      payment_method: data.payment_method || null,
      occurred_at: data.occurred_at ? dayStart(data.occurred_at) : new Date(),
      created_by: data.created_by || null,
    },
  });
}

export async function deleteTransaction(companyId: string, id: string) {
  const result = await prisma.financialTransaction.deleteMany({
    where: { id, company_id: companyId },
  });
  if (result.count === 0) throw new Error("Lançamento não encontrado");
  return { id };
}

/* ════════════════════════════════════════════════════════════════
   Payment methods config (Phase 4)
   ════════════════════════════════════════════════════════════════ */

export async function getPaymentMethods(companyId: string) {
  return prisma.paymentMethodConfig.findMany({
    where: { company_id: companyId },
    orderBy: { method: "asc" },
  });
}

export async function upsertPaymentMethod(
  companyId: string,
  method: "cash" | "pix" | "credit" | "debit" | "other",
  data: { is_enabled?: boolean; fee_percent?: number | null },
) {
  return prisma.paymentMethodConfig.upsert({
    where: { company_id_method: { company_id: companyId, method } },
    create: {
      company_id: companyId,
      method,
      is_enabled: data.is_enabled ?? true,
      fee_percent: data.fee_percent ?? null,
    },
    update: {
      ...(data.is_enabled !== undefined ? { is_enabled: data.is_enabled } : {}),
      ...(data.fee_percent !== undefined
        ? { fee_percent: data.fee_percent }
        : {}),
      updated_at: new Date(),
    },
  });
}

/* ════════════════════════════════════════════════════════════════
   Cash register (Phase 4)
   ════════════════════════════════════════════════════════════════ */

export async function getCurrentCashRegister(companyId: string) {
  return prisma.cashRegister.findFirst({
    where: { company_id: companyId, status: "open" },
    orderBy: { opened_at: "desc" },
  });
}

export async function openCashRegister(
  companyId: string,
  openingFloat: number,
  openedBy?: string,
) {
  const open = await getCurrentCashRegister(companyId);
  if (open) throw new Error("Já existe um caixa aberto");
  return prisma.cashRegister.create({
    data: {
      company_id: companyId,
      opening_float: round2(Number(openingFloat) || 0),
      opened_by: openedBy || null,
      status: "open",
    },
  });
}

export async function closeCashRegister(
  companyId: string,
  registerId: string,
  closingTotal: number,
) {
  const reg = await prisma.cashRegister.findFirst({
    where: { id: registerId, company_id: companyId, status: "open" },
  });
  if (!reg) throw new Error("Caixa não encontrado ou já fechado");

  // Expected = opening float + cash income since it was opened.
  const cashAgg = await prisma.financialTransaction.aggregate({
    _sum: { amount: true },
    where: {
      company_id: companyId,
      type: "income",
      payment_method: "cash",
      created_at: { gte: reg.opened_at },
    },
  });
  const expected = round2(num(reg.opening_float) + num(cashAgg._sum.amount));

  return prisma.cashRegister.update({
    where: { id: registerId },
    data: {
      status: "closed",
      closing_total: round2(Number(closingTotal) || 0),
      expected_total: expected,
      closed_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/* ════════════════════════════════════════════════════════════════
   Commissions & payouts (Phase 3)
   ════════════════════════════════════════════════════════════════ */

/** Pending commission totals grouped by attendant (with names). */
export async function getPendingCommissionsByAttendant(companyId: string) {
  const grouped = await prisma.commission.groupBy({
    by: ["attendant_id"],
    where: { company_id: companyId, status: "pending" },
    _sum: { amount: true },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const attendants = await prisma.attendant.findMany({
    where: { id: { in: grouped.map((g) => g.attendant_id) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(attendants.map((a) => [a.id, a.name]));
  return grouped.map((g) => ({
    attendant_id: g.attendant_id,
    attendant_name: nameMap.get(g.attendant_id) ?? "—",
    pending_total: round2(num(g._sum.amount)),
    count: g._count._all,
  }));
}

export async function listCommissions(
  companyId: string,
  opts: { attendantId?: string; status?: string } = {},
) {
  return prisma.commission.findMany({
    where: {
      company_id: companyId,
      ...(opts.attendantId ? { attendant_id: opts.attendantId } : {}),
      ...(opts.status ? { status: opts.status as any } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 500,
  });
}

/** One-click "pay commissions": settle all pending for an attendant. */
export async function payAttendantCommissions(
  companyId: string,
  attendantId: string,
) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.commission.findMany({
      where: { company_id: companyId, attendant_id: attendantId, status: "pending" },
      select: { id: true, amount: true, created_at: true },
    });
    if (pending.length === 0) throw new Error("Nada pendente para repassar");

    const total = round2(pending.reduce((s, c) => s + num(c.amount), 0));
    const dates = pending.map((c) => c.created_at.getTime());
    const periodStart = new Date(Math.min(...dates));
    const periodEnd = new Date(Math.max(...dates));

    const payout = await tx.commissionPayout.create({
      data: {
        company_id: companyId,
        attendant_id: attendantId,
        period_start: periodStart,
        period_end: periodEnd,
        total_amount: total,
        status: "paid",
        paid_at: new Date(),
      },
    });

    await tx.commission.updateMany({
      where: { company_id: companyId, attendant_id: attendantId, status: "pending" },
      data: { status: "paid", payout_id: payout.id, updated_at: new Date() },
    });

    // Record the payout as an expense in the ledger.
    await tx.financialTransaction.create({
      data: {
        company_id: companyId,
        type: "expense",
        source: "manual",
        category: "commission",
        description: "Repasse de comissão",
        amount: total,
        occurred_at: new Date(),
        attendant_id: attendantId,
      },
    });

    return payout;
  });
}

export async function listPayouts(companyId: string) {
  const payouts = await prisma.commissionPayout.findMany({
    where: { company_id: companyId },
    orderBy: { created_at: "desc" },
    take: 200,
  });
  if (payouts.length === 0) return [];
  const attendants = await prisma.attendant.findMany({
    where: { id: { in: payouts.map((p) => p.attendant_id) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(attendants.map((a) => [a.id, a.name]));
  return payouts.map((p) => ({
    ...p,
    attendant_name: nameMap.get(p.attendant_id) ?? "—",
  }));
}
