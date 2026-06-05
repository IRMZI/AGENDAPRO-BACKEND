/**
 * Demo seed — fully mocks the "demounhas@gmail.com" company as if it had been
 * operating for a full year: ~1 year of bookings across statuses, income +
 * commission per completed appointment, recurring monthly operating expenses,
 * monthly commission payouts (history) with the current month left pending,
 * payment-method fees, cash registers, a plan + paid subscription.
 *
 * Idempotent: WIPES this company's data first (scoped strictly by company_id)
 * and re-seeds. It never touches other companies.
 *
 * Run:  cd Backend && npx tsx prisma/seed-demo.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const DEMO_EMAIL = "demounhas@gmail.com";
const HISTORY_DAYS = 365; // a full year back
const FUTURE_DAYS = 21;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a: number, b: number) =>
  Math.floor(Math.random() * (b - a + 1)) + a;
const chance = (p: number) => Math.random() < p;

/** A date N days from today, anchored at noon UTC to avoid day-shifts. */
const dayOffset = (n: number) => {
  const d = new Date();
  const base = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  );
  base.setUTCDate(base.getUTCDate() + n);
  return base;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const TIMES = [
  "09:00", "09:30", "10:00", "10:30", "11:00",
  "13:00", "13:30", "14:00", "15:00", "16:00", "17:00",
];
const PAYMENTS = ["cash", "pix", "credit", "debit"] as const;

async function main() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) throw new Error(`Demo user ${DEMO_EMAIL} not found`);
  const company = await prisma.company.findUnique({
    where: { user_id: user.id },
  });
  if (!company) throw new Error("Demo company not found");
  const companyId = company.id;
  console.log(`▶ Seeding demo (1 year): ${company.name} (${companyId})`);

  // ── 1. WIPE existing demo data (scoped to this company) ──────────────────
  await prisma.financialTransaction.deleteMany({ where: { company_id: companyId } });
  await prisma.commission.deleteMany({ where: { company_id: companyId } });
  await prisma.commissionPayout.deleteMany({ where: { company_id: companyId } });
  await prisma.cashRegister.deleteMany({ where: { company_id: companyId } });
  await prisma.paymentMethodConfig.deleteMany({ where: { company_id: companyId } });
  await prisma.subscriptionSession.deleteMany({ where: { company_id: companyId } });
  await prisma.booking.deleteMany({ where: { company_id: companyId } });
  await prisma.clientSubscription.deleteMany({ where: { company_id: companyId } });
  await prisma.plan.deleteMany({ where: { company_id: companyId } });
  await prisma.attendant.deleteMany({ where: { company_id: companyId } });
  await prisma.service.deleteMany({ where: { company_id: companyId } });
  await prisma.client.deleteMany({ where: { company_id: companyId } });
  console.log("  ✓ wiped previous demo data");

  // ── 2. Permissions: enable all modules ───────────────────────────────────
  await prisma.companyPermission.upsert({
    where: { company_id: companyId },
    create: { company_id: companyId, use_financeiro: true, use_conversation: true, use_google_agenda: true },
    update: { use_financeiro: true, use_conversation: true, use_google_agenda: true },
  });

  // ── 3. Business hours (Mon–Sat 09–18) ────────────────────────────────────
  for (let wd = 0; wd <= 6; wd++) {
    const open = wd !== 0;
    await prisma.companyBusinessHours.upsert({
      where: { company_id_weekday: { company_id: companyId, weekday: wd } },
      create: { company_id: companyId, weekday: wd, is_open: open, open_time: open ? "09:00" : null, close_time: open ? "18:00" : null },
      update: { is_open: open, open_time: open ? "09:00" : null, close_time: open ? "18:00" : null },
    });
  }

  // ── 4. Services ──────────────────────────────────────────────────────────
  const serviceDefs = [
    { name: "Manicure", duration_minutes: 40, price: 40 },
    { name: "Pedicure", duration_minutes: 50, price: 45 },
    { name: "Esmaltação em gel", duration_minutes: 60, price: 70 },
    { name: "Alongamento de unhas", duration_minutes: 120, price: 150 },
    { name: "Spa dos pés", duration_minutes: 60, price: 90 },
    { name: "Blindagem de unhas", duration_minutes: 70, price: 120 },
    { name: "Banho de gel", duration_minutes: 90, price: 110 },
  ];
  const services = [];
  for (const s of serviceDefs) {
    services.push(await prisma.service.create({ data: { company_id: companyId, is_active: true, ...s } }));
  }
  console.log(`  ✓ ${services.length} services`);

  // ── 5. Attendants (some with commission + login) ─────────────────────────
  const passwordHash = await bcrypt.hash("demo123", 10);
  const attendantDefs = [
    { name: "Ana Souza", username: "ana", commission: 50, login: "ana.demounhas@gmail.com" },
    { name: "Bruna Lima", username: "bruna", commission: 40, login: "bruna.demounhas@gmail.com" },
    { name: "Carla Dias", username: "carla", commission: 30, login: null },
    { name: "Duda Reis", username: "duda", commission: null, login: null },
  ];
  const attendants = [];
  for (const a of attendantDefs) {
    let userId: string | null = null;
    if (a.login) {
      const u = await prisma.user.upsert({
        where: { email: a.login },
        create: { email: a.login, password_hash: passwordHash },
        update: { password_hash: passwordHash },
      });
      userId = u.id;
      await prisma.userProfile.upsert({
        where: { user_id_company_id: { user_id: u.id, company_id: companyId } },
        create: { user_id: u.id, company_id: companyId, role: "attendant", full_name: a.name },
        update: { role: "attendant", full_name: a.name },
      });
    }
    const att = await prisma.attendant.create({
      data: {
        company_id: companyId, name: a.name, username: a.username,
        email: a.login ?? `${a.username}@demo.local`,
        phone: `1199${randInt(1000000, 9999999)}`, is_active: true, user_id: userId,
        login_enabled: !!a.login, commission_enabled: a.commission != null, commission_percent: a.commission,
      },
    });
    for (let wd = 1; wd <= 6; wd++) {
      await prisma.attendantWeekday.create({
        data: { attendant_id: att.id, weekday: wd, is_active: true, start_time: "09:00", end_time: "18:00" },
      });
    }
    attendants.push(att);
  }
  console.log(`  ✓ ${attendants.length} attendants (2 com login: senha "demo123")`);

  // ── 6. Clients ───────────────────────────────────────────────────────────
  const firstNames = ["Maria", "Joana", "Patrícia", "Fernanda", "Beatriz", "Larissa", "Camila", "Renata", "Aline", "Sabrina", "Vanessa", "Tatiane", "Priscila", "Bianca", "Letícia", "Gabriela", "Juliana", "Carolina", "Mariana", "Débora"];
  const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Pereira", "Costa", "Almeida", "Rodrigues"];
  const clients = [];
  for (let i = 0; i < firstNames.length; i++) {
    clients.push(await prisma.client.create({
      data: { company_id: companyId, name: `${firstNames[i]} ${pick(lastNames)}`, phone: `1198${String(1000000 + i)}`, email: `${firstNames[i].toLowerCase()}${i}@cliente.demo` },
    }));
  }
  console.log(`  ✓ ${clients.length} clients`);

  // ── 7. Bookings + financials (≈1 year), bulk-inserted ────────────────────
  const bookingsData: any[] = [];
  const bookingServicesData: any[] = [];
  const incomeData: any[] = [];
  const commissionRows: any[] = [];
  const commissionData: { attendant_id: string; amount: number; date: Date }[] = [];
  let completedCount = 0;

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = dayOffset(offset);
    if (date.getUTCDay() === 0) continue; // closed Sundays
    const perDay = randInt(1, 4);
    for (let i = 0; i < perDay; i++) {
      const attendant = pick(attendants);
      const service = pick(services);
      const client = pick(clients);
      const time = pick(TIMES);

      let status: string;
      if (offset < 0) status = chance(0.8) ? "completed" : chance(0.5) ? "cancelled" : "no_show";
      else if (offset === 0) status = pick(["confirmed", "completed", "pending"]);
      else status = chance(0.5) ? "confirmed" : "pending";

      const price = Number(service.price ?? 0);
      const isCompleted = status === "completed";
      const paymentMethod = isCompleted ? pick(PAYMENTS) : null;
      const bookingId = randomUUID();

      bookingsData.push({
        id: bookingId, company_id: companyId, attendant_id: attendant.id, client_id: client.id,
        client_name: client.name, client_phone: client.phone, client_email: client.email ?? "",
        service: service.name, service_id: service.id, booking_date: date, booking_time: time,
        date_time: new Date(`${ymd(date)}T${time}:00`), status,
        total_amount: isCompleted ? price : null, payment_method: paymentMethod,
        completed_at: isCompleted ? date : null, created_at: date, updated_at: date,
      });
      bookingServicesData.push({ booking_id: bookingId, service_id: service.id, price_snapshot: price, created_at: date });

      if (isCompleted) {
        completedCount++;
        incomeData.push({
          company_id: companyId, type: "income", source: "booking", category: "service",
          description: `Atendimento · ${client.name} (${service.name})`, amount: price,
          payment_method: paymentMethod, occurred_at: date, booking_id: bookingId,
          attendant_id: attendant.id, created_at: date,
        });
        if (attendant.commission_enabled && attendant.commission_percent != null) {
          const percent = Number(attendant.commission_percent);
          const amount = round2((price * percent) / 100);
          commissionData.push({ attendant_id: attendant.id, amount, date });
          commissionRows.push({
            company_id: companyId, attendant_id: attendant.id, booking_id: bookingId,
            base_amount: price, percent, amount, status: "pending", created_at: date,
          });
        }
      }
    }
  }
  await prisma.booking.createMany({ data: bookingsData });
  await prisma.bookingService.createMany({ data: bookingServicesData });
  await prisma.financialTransaction.createMany({ data: incomeData });
  await prisma.commission.createMany({ data: commissionRows });
  console.log(`  ✓ ${bookingsData.length} bookings (${completedCount} completed) · ${incomeData.length} income · ${commissionRows.length} commissions`);

  // ── 8. Recurring monthly operating expenses (last 13 months) ─────────────
  const now = new Date();
  const monthlyExpenses = [
    { category: "rent", description: "Aluguel do salão", amount: 1500, day: 5 },
    { category: "utilities", description: "Energia, água e internet", amount: 520, day: 10 },
    { category: "products", description: "Reposição de esmaltes e materiais", amount: 430, day: 14 },
    { category: "marketing", description: "Anúncios (Instagram/Google)", amount: 180, day: 20 },
    { category: "supplies", description: "Materiais descartáveis", amount: 240, day: 24 },
  ];
  const expenseRows: any[] = [];
  for (let k = 0; k <= 12; k++) {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1, 12));
    for (const e of monthlyExpenses) {
      const d = new Date(base);
      d.setUTCDate(e.day);
      if (d > now) continue; // don't post future-dated expenses
      expenseRows.push({
        company_id: companyId, type: "expense", source: "manual", category: e.category,
        description: e.description, amount: e.amount, occurred_at: d, created_at: d,
      });
    }
  }
  await prisma.financialTransaction.createMany({ data: expenseRows });
  console.log(`  ✓ ${expenseRows.length} recurring monthly expenses`);

  // ── 9. Payment method configs (with card fees) ───────────────────────────
  const methodFees: Record<string, number | null> = { cash: null, pix: null, credit: 3.5, debit: 1.5, other: null };
  for (const [method, fee] of Object.entries(methodFees)) {
    await prisma.paymentMethodConfig.upsert({
      where: { company_id_method: { company_id: companyId, method: method as any } },
      create: { company_id: companyId, method: method as any, is_enabled: true, fee_percent: fee },
      update: { is_enabled: true, fee_percent: fee },
    });
  }

  // ── 10. Monthly commission payouts (history); current month stays pending ─
  const currentMonthKey = ymd(dayOffset(0)).slice(0, 7);
  const groups = new Map<string, { attId: string; monthKey: string; total: number }>();
  for (const c of commissionData) {
    const mk = ymd(c.date).slice(0, 7);
    if (mk >= currentMonthKey) continue; // leave the current month pending
    const key = `${c.attendant_id}|${mk}`;
    const g = groups.get(key) ?? { attId: c.attendant_id, monthKey: mk, total: 0 };
    g.total = round2(g.total + c.amount);
    groups.set(key, g);
  }
  let payoutCount = 0;
  for (const g of groups.values()) {
    const [y, m] = g.monthKey.split("-").map(Number);
    const periodStart = new Date(Date.UTC(y, m - 1, 1, 12));
    const periodEnd = new Date(Date.UTC(y, m, 0, 12)); // last day of month
    const payout = await prisma.commissionPayout.create({
      data: {
        company_id: companyId, attendant_id: g.attId, period_start: periodStart,
        period_end: periodEnd, total_amount: g.total, status: "paid", paid_at: periodEnd,
      },
    });
    await prisma.commission.updateMany({
      where: {
        company_id: companyId, attendant_id: g.attId, status: "pending",
        created_at: { gte: new Date(Date.UTC(y, m - 1, 1, 0)), lt: new Date(Date.UTC(y, m, 1, 0)) },
      },
      data: { status: "paid", payout_id: payout.id },
    });
    await prisma.financialTransaction.create({
      data: {
        company_id: companyId, type: "expense", source: "manual", category: "commission",
        description: `Repasse de comissão · ${g.monthKey}`, amount: g.total,
        occurred_at: periodEnd, attendant_id: g.attId, created_at: periodEnd,
      },
    });
    payoutCount++;
  }
  console.log(`  ✓ ${payoutCount} monthly commission payouts (current month pending)`);

  // ── 11. Cash register: one open today + one closed (history) ─────────────
  const closed = dayOffset(-3);
  await prisma.cashRegister.create({
    data: {
      company_id: companyId, opening_float: 150, closing_total: 980, expected_total: 965,
      status: "closed", opened_at: closed, closed_at: new Date(closed.getTime() + 8 * 3600 * 1000),
    },
  });
  await prisma.cashRegister.create({ data: { company_id: companyId, opening_float: 150, status: "open" } });
  console.log("  ✓ cash registers (1 open, 1 closed)");

  // ── 12. A plan + a paid subscription (income) ────────────────────────────
  const manicure = services.find((s) => s.name === "Manicure") ?? services[0];
  const plan = await prisma.plan.create({
    data: {
      company_id: companyId, service_id: manicure.id, name: "Pacote 4 Manicures",
      description: "4 sessões de manicure", plan_type: "sessions", total_sessions: 4, price: 140, is_active: true,
    },
  });
  const subClient = pick(clients);
  const sub = await prisma.clientSubscription.create({
    data: {
      client_id: subClient.id, plan_id: plan.id, company_id: companyId, sessions_remaining: 3,
      sessions_used: 1, status: "active", start_date: dayOffset(-10), amount_paid: 140, payment_status: "paid",
    },
  });
  await prisma.financialTransaction.create({
    data: {
      company_id: companyId, type: "income", source: "subscription", category: "subscription",
      description: `Assinatura · ${subClient.name} (${plan.name})`, amount: 140,
      occurred_at: dayOffset(-10), subscription_id: sub.id, created_at: dayOffset(-10),
    },
  });
  console.log("  ✓ plan + paid subscription");

  console.log("\n✅ Demo seed complete (≈1 ano de operação).");
  console.log("   Owner login: demounhas@gmail.com");
  console.log('   Attendant logins: ana.demounhas@gmail.com / bruna.demounhas@gmail.com (senha: demo123)');
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
