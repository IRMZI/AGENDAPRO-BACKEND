/**
 * Demo seed — "demounhas" nail studio, filled for a PRODUCT COVER screenshot.
 *
 * Fills the ENTIRE calendar year 2026 (Jan 1 → Dec 31) so any month, week or day
 * the camera lands on reads as a busy, established studio:
 *   • bookings packed per attendant/day respecting each service's duration + a
 *     lunch break, so the calendar NEVER shows two overlapping cards (the old
 *     seed-demo.ts picks random times and overlaps — do not use it)
 *   • density tapers with distance from "today" (fuller now, lighter far future)
 *     to keep the ~4–5k bookings payload snappy while every day stays populated
 *   • "today" reads like a live day: mornings completed, midday in progress,
 *     afternoon confirmed/pending
 *   • income + commissions + monthly expenses + payouts + plans + subscriptions
 *     + cash registers + payment fees + quick-reply templates → no empty screens
 *
 * "today" is anchored on the LOCAL calendar date (not UTC): the app compares
 * booking_date's UTC date-portion against the browser's local day, and each day
 * is stored at NOON UTC so its date-portion equals the intended local day even
 * in UTC-3. Re-run on the morning of the shoot to re-anchor the live day.
 *
 * Idempotent + SAFE: reuses the existing demounhas company, refuses to run if the
 * resolved company id doesn't match, WIPES only that company's data, re-seeds.
 * Never creates/deletes the owner user and never touches other companies.
 *
 * Run:  cd Backend && <node22> node_modules/tsx/dist/cli.mjs prisma/seed-demounhas.ts
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const OWNER_EMAIL = "demounhas@gmail.com";
const EXPECTED_COMPANY_ID = "631356be-1346-422e-871a-1c0e262d9194"; // safety guard
const COMPANY_NAME = "Bella Unhas Studio";
const ATTENDANT_PASSWORD = "demo123";
const YEAR = 2026;

// Opening hours in minutes-from-midnight. Nail studio: Mon–Sat 09:00–19:00.
const OPEN_MIN = 9 * 60;
const CLOSE_MIN = 19 * 60;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a: number, b: number) =>
  Math.floor(Math.random() * (b - a + 1)) + a;
const chance = (p: number) => Math.random() < p;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .split("")
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n < 0x300 || n > 0x36f;
    })
    .join("");
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "today" as the LOCAL calendar date, anchored at noon UTC (see header). */
const now = new Date();
const TODAY = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
const TODAY_MS = TODAY.getTime();
const DAY_MS = 86_400_000;

/** Payment mix weighted like a real BR salon (pix-heavy). */
const payment = () => {
  const r = Math.random();
  if (r < 0.45) return "pix";
  if (r < 0.7) return "credit";
  if (r < 0.9) return "debit";
  return "cash";
};

type Svc = { id: string; name: string; duration_minutes: number; price: number };

/** createMany in batches — Postgres caps a statement at 65535 bind params. */
async function createManyChunked(
  model: { createMany: (a: { data: any[] }) => Promise<unknown> },
  data: any[],
  size = 500,
) {
  for (let i = 0; i < data.length; i += size) {
    await model.createMany({ data: data.slice(i, i + size) });
  }
}

/** Greedily packs one attendant's day back-to-back, jumping lunch, no overlaps. */
function packDay(services: Svc[], target: number) {
  const out: { startMin: number; service: Svc }[] = [];
  let cursor = OPEN_MIN + pick([0, 0, 15, 30]);
  let guard = 0;
  while (out.length < target && cursor < CLOSE_MIN && guard++ < 40) {
    const service = pick(services);
    const dur = service.duration_minutes;
    if (cursor < LUNCH_END && cursor + dur > LUNCH_START) {
      cursor = LUNCH_END; // don't start something that runs into lunch
      continue;
    }
    if (cursor + dur > CLOSE_MIN) break;
    out.push({ startMin: cursor, service });
    cursor += dur + pick([0, 0, 10, 15, 30]);
  }
  return out;
}

/** Bookings per attendant per day: busy now, growth curve into the past, lighter far future. */
function targetFor(offset: number, isSaturday: boolean) {
  let base: number;
  if (offset === 0) base = randInt(5, 6);
  else if (offset < 0) {
    if (offset <= -120) base = randInt(3, 4);
    else if (offset <= -30) base = randInt(4, 5);
    else base = randInt(4, 6);
  } else {
    if (offset <= 21) base = randInt(4, 5);
    else if (offset <= 60) base = randInt(3, 4);
    else base = randInt(2, 3);
  }
  return isSaturday ? base + 1 : base;
}

async function main() {
  // ── 0. Resolve owner + company (reuse only; hard safety guard) ────────────
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!owner) throw new Error(`Owner user ${OWNER_EMAIL} not found — aborting.`);
  const existing = await prisma.company.findUnique({ where: { user_id: owner.id } });
  if (!existing) throw new Error(`No company for ${OWNER_EMAIL} — aborting.`);
  if (existing.id !== EXPECTED_COMPANY_ID) {
    throw new Error(
      `Refusing to seed: resolved company ${existing.id} ("${existing.name}") ` +
        `!= expected demo company ${EXPECTED_COMPANY_ID}.`,
    );
  }

  const company = await prisma.company.update({
    where: { id: existing.id },
    data: {
      name: COMPANY_NAME,
      company_nickname: COMPANY_NAME,
      is_active: true,
      subscription_status: "active",
      first_login_completed: true,
      show_unassigned_services: true,
    },
  });
  const companyId = company.id;
  console.log(`▶ Seeding ${company.name} (${companyId}) · full year ${YEAR}`);
  console.log(`  today anchor (local): ${ymd(TODAY)}`);

  // ── 1. WIPE existing demo data (scoped strictly to this company) ──────────
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
  await prisma.messageTemplate.deleteMany({ where: { company_id: companyId } });
  console.log("  ✓ wiped previous demo data");

  // ── 2. Permissions: enable all modules ───────────────────────────────────
  await prisma.companyPermission.upsert({
    where: { company_id: companyId },
    create: { company_id: companyId, use_financeiro: true, use_conversation: true, use_google_agenda: true },
    update: { use_financeiro: true, use_conversation: true, use_google_agenda: true },
  });

  // ── 3. Business hours (Mon–Sat 09–19, closed Sunday) ─────────────────────
  for (let wd = 0; wd <= 6; wd++) {
    const open = wd !== 0;
    await prisma.companyBusinessHours.upsert({
      where: { company_id_weekday: { company_id: companyId, weekday: wd } },
      create: { company_id: companyId, weekday: wd, is_open: open, open_time: open ? "09:00" : null, close_time: open ? "19:00" : null },
      update: { is_open: open, open_time: open ? "09:00" : null, close_time: open ? "19:00" : null },
    });
  }

  // ── 4. Services ──────────────────────────────────────────────────────────
  const serviceDefs = [
    { name: "Manicure simples", duration_minutes: 40, price: 45, description: "Cutilagem, lixamento e esmaltação." },
    { name: "Pedicure completa", duration_minutes: 50, price: 55, description: "Cuidado completo dos pés com esfoliação." },
    { name: "Esmaltação em gel", duration_minutes: 60, price: 80, description: "Esmaltação em gel com durabilidade de até 3 semanas." },
    { name: "Alongamento em fibra", duration_minutes: 120, price: 180, description: "Alongamento com fibra de vidro." },
    { name: "Manutenção de alongamento", duration_minutes: 90, price: 120, description: "Manutenção do alongamento a cada 3 semanas." },
    { name: "Blindagem de unhas", duration_minutes: 60, price: 90, description: "Fortalecimento e blindagem da unha natural." },
    { name: "Spa dos pés", duration_minutes: 60, price: 100, description: "Esfoliação, hidratação e massagem." },
    { name: "Nail art (por unha)", duration_minutes: 30, price: 25, description: "Decoração artística personalizada." },
  ];
  const services: Svc[] = [];
  for (const s of serviceDefs) {
    const created = await prisma.service.create({ data: { company_id: companyId, is_active: true, ...s } });
    services.push({ id: created.id, name: created.name, duration_minutes: created.duration_minutes, price: Number(created.price ?? 0) });
  }
  console.log(`  ✓ ${services.length} services`);

  // ── 5. Attendants (2 with login + commission) ────────────────────────────
  const passwordHash = await bcrypt.hash(ATTENDANT_PASSWORD, 10);
  const attendantDefs = [
    { name: "Ana Paula", username: "ana", commission: 40 as number | null, login: "ana.demounhas@gmail.com" as string | null },
    { name: "Bruna Costa", username: "bruna", commission: 35, login: "bruna.demounhas@gmail.com" },
    { name: "Carla Mendes", username: "carla", commission: 30, login: null },
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
        email: a.login ?? `${a.username}@demounhas.demo`,
        phone: `1199${randInt(1000000, 9999999)}`, is_active: true, user_id: userId,
        login_enabled: !!a.login, commission_enabled: a.commission != null, commission_percent: a.commission,
      },
    });
    for (let wd = 1; wd <= 6; wd++) {
      await prisma.attendantWeekday.create({
        data: { attendant_id: att.id, weekday: wd, is_active: true, start_time: "09:00", end_time: "19:00" },
      });
    }
    for (const s of services) {
      await prisma.serviceAttendant.create({ data: { service_id: s.id, attendant_id: att.id } });
    }
    attendants.push(att);
  }
  console.log(`  ✓ ${attendants.length} attendants (2 com login: senha "${ATTENDANT_PASSWORD}")`);

  // ── 6. Clients ───────────────────────────────────────────────────────────
  const firstNames = [
    "Maria", "Joana", "Patrícia", "Fernanda", "Beatriz", "Larissa", "Camila", "Renata",
    "Aline", "Sabrina", "Vanessa", "Tatiane", "Priscila", "Bianca", "Letícia", "Gabriela",
    "Juliana", "Carolina", "Mariana", "Débora", "Amanda", "Isabela", "Rafaela", "Natália",
    "Bruna", "Carla", "Eduarda", "Flávia", "Helena", "Ingrid", "Jéssica", "Kelly",
    "Luana", "Michele", "Nayara", "Olívia", "Paula", "Raquel", "Simone", "Thaís",
    "Vitória", "Yasmin", "Adriana", "Cristiane", "Elaine",
  ];
  const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Pereira", "Costa", "Almeida", "Rodrigues", "Ferreira", "Gomes"];
  const clients = [];
  for (let i = 0; i < firstNames.length; i++) {
    clients.push(await prisma.client.create({
      data: {
        company_id: companyId,
        name: `${firstNames[i]} ${pick(lastNames)}`,
        phone: `1198${String(1000000 + i)}`,
        email: `${slug(firstNames[i])}${i}@cliente.demo`,
      },
    }));
  }
  console.log(`  ✓ ${clients.length} clients`);

  // ── 7. Bookings + financials (full year 2026) ────────────────────────────
  const bookingsData: any[] = [];
  const bookingServicesData: any[] = [];
  const incomeData: any[] = [];
  const commissionRows: any[] = [];
  const commissionData: { attendant_id: string; amount: number; date: Date }[] = [];
  let completedCount = 0;
  let futureCount = 0;

  const jan1 = new Date(Date.UTC(YEAR, 0, 1, 12));
  const dec31 = new Date(Date.UTC(YEAR, 11, 31, 12));
  for (const cursor = new Date(jan1); cursor <= dec31; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    const wd = date.getUTCDay();
    if (wd === 0) continue; // closed Sundays
    const offset = Math.round((date.getTime() - TODAY_MS) / DAY_MS);

    for (const attendant of attendants) {
      const slots = packDay(services, targetFor(offset, wd === 6));
      for (const { startMin, service } of slots) {
        const client = pick(clients);
        const time = hhmm(startMin);

        let status: string;
        if (offset < 0) {
          status = chance(0.88) ? "completed" : chance(0.6) ? "cancelled" : "no_show";
        } else if (offset === 0) {
          if (startMin < LUNCH_START) status = "completed";
          else if (startMin < LUNCH_END + 60) status = "in_progress";
          else status = chance(0.7) ? "confirmed" : "pending";
        } else {
          status = chance(0.6) ? "confirmed" : "pending";
          futureCount++;
        }

        const price = service.price;
        const isCompleted = status === "completed";
        const paymentMethod = isCompleted ? payment() : null;
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
  }
  await createManyChunked(prisma.booking, bookingsData);
  await createManyChunked(prisma.bookingService, bookingServicesData);
  await createManyChunked(prisma.financialTransaction, incomeData);
  await createManyChunked(prisma.commission, commissionRows);
  console.log(
    `  ✓ ${bookingsData.length} bookings (${completedCount} completed · ${futureCount} futuros) · ${incomeData.length} income · ${commissionRows.length} commissions`,
  );

  // ── 8. Recurring monthly operating expenses (Jan → current month) ────────
  const monthlyExpenses = [
    { category: "rent", description: "Aluguel do estúdio", amount: 1800, day: 5 },
    { category: "utilities", description: "Energia, água e internet", amount: 610, day: 10 },
    { category: "products", description: "Reposição de esmaltes e materiais", amount: 780, day: 14 },
    { category: "marketing", description: "Anúncios (Instagram/Google)", amount: 350, day: 20 },
    { category: "supplies", description: "Materiais descartáveis", amount: 290, day: 24 },
  ];
  const expenseRows: any[] = [];
  for (let m = 0; m <= TODAY.getUTCMonth(); m++) {
    for (const e of monthlyExpenses) {
      const d = new Date(Date.UTC(YEAR, m, e.day, 12));
      if (d > TODAY) continue; // don't post future-dated expenses
      expenseRows.push({
        company_id: companyId, type: "expense", source: "manual", category: e.category,
        description: e.description, amount: e.amount, occurred_at: d, created_at: d,
      });
    }
  }
  await createManyChunked(prisma.financialTransaction, expenseRows);
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
  const currentMonthKey = ymd(TODAY).slice(0, 7);
  const groups = new Map<string, { attId: string; monthKey: string; total: number }>();
  for (const c of commissionData) {
    const mk = ymd(c.date).slice(0, 7);
    if (mk >= currentMonthKey) continue;
    const key = `${c.attendant_id}|${mk}`;
    const g = groups.get(key) ?? { attId: c.attendant_id, monthKey: mk, total: 0 };
    g.total = round2(g.total + c.amount);
    groups.set(key, g);
  }
  let payoutCount = 0;
  for (const g of groups.values()) {
    const [y, m] = g.monthKey.split("-").map(Number);
    const periodStart = new Date(Date.UTC(y, m - 1, 1, 12));
    const periodEnd = new Date(Date.UTC(y, m, 0, 12));
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
  console.log(`  ✓ ${payoutCount} monthly commission payouts (mês atual pendente)`);

  // ── 11. Cash register: one open today + two closed (history) ─────────────
  for (const back of [7, 3]) {
    const closed = new Date(TODAY_MS - back * DAY_MS);
    const expected = randInt(700, 1400);
    await prisma.cashRegister.create({
      data: {
        company_id: companyId, opening_float: 200, closing_total: expected + randInt(-20, 20),
        expected_total: expected, status: "closed", opened_at: closed,
        closed_at: new Date(closed.getTime() + 9 * 3600 * 1000),
      },
    });
  }
  await prisma.cashRegister.create({ data: { company_id: companyId, opening_float: 200, status: "open" } });
  console.log("  ✓ cash registers (1 aberto, 2 fechados)");

  // ── 12. Plans + client subscriptions (with sessions) ─────────────────────
  const byName = (n: string) => services.find((s) => s.name === n)!;
  const planDefs = [
    { name: "Pacote 4 Manicures", description: "4 sessões de manicure simples", service: byName("Manicure simples"), total_sessions: 4, price: 160 },
    { name: "Pacote Gel Mensal", description: "2 esmaltações em gel por mês", service: byName("Esmaltação em gel"), total_sessions: 2, price: 145 },
    { name: "Pacote Manutenção Trimestral", description: "4 manutenções de alongamento", service: byName("Manutenção de alongamento"), total_sessions: 4, price: 420 },
  ];
  const plans = [];
  for (const p of planDefs) {
    plans.push(await prisma.plan.create({
      data: {
        company_id: companyId, service_id: p.service.id, name: p.name, description: p.description,
        plan_type: "sessions", total_sessions: p.total_sessions, price: p.price, is_active: true,
      },
    }));
  }
  const subClients = [...clients].sort(() => Math.random() - 0.5).slice(0, 6);
  let subCount = 0;
  for (const subClient of subClients) {
    const idx = randInt(0, plans.length - 1);
    const plan = plans[idx];
    const total = planDefs[idx].total_sessions;
    const used = randInt(1, total - 1);
    const startedAt = new Date(TODAY_MS - randInt(10, 60) * DAY_MS);
    const sub = await prisma.clientSubscription.create({
      data: {
        client_id: subClient.id, plan_id: plan.id, company_id: companyId,
        sessions_remaining: total - used, sessions_used: used, status: "active",
        start_date: startedAt, next_booking_date: new Date(TODAY_MS + randInt(3, 20) * DAY_MS),
        last_booking_date: new Date(TODAY_MS - randInt(1, 9) * DAY_MS),
        amount_paid: Number(plan.price), payment_status: "paid",
      },
    });
    for (let n = 1; n <= total; n++) {
      const done = n <= used;
      await prisma.subscriptionSession.create({
        data: {
          subscription_id: sub.id, company_id: companyId, session_number: n,
          status: done ? "completed" : "scheduled",
          scheduled_date: done ? new Date(TODAY_MS - randInt(1, 50) * DAY_MS) : new Date(TODAY_MS + randInt(3, 40) * DAY_MS),
          scheduled_time: pick(["09:00", "10:30", "14:00", "15:30", "17:00"]),
          completed_at: done ? new Date(TODAY_MS - randInt(1, 50) * DAY_MS) : null,
          attendant_id: pick(attendants).id,
        },
      });
    }
    await prisma.financialTransaction.create({
      data: {
        company_id: companyId, type: "income", source: "subscription", category: "subscription",
        description: `Assinatura · ${subClient.name} (${plan.name})`, amount: Number(plan.price),
        occurred_at: startedAt, subscription_id: sub.id, created_at: startedAt,
      },
    });
    subCount++;
  }
  console.log(`  ✓ ${plans.length} plans · ${subCount} assinaturas ativas`);

  // ── 13. Quick-reply templates (WhatsApp inbox) ───────────────────────────
  const templates = [
    { title: "Confirmação", shortcut: "/conf", body: `Oi {{cliente}}! Confirmando seu horário no ${COMPANY_NAME} para {{data}} às {{hora}}. Posso confirmar? 💅` },
    { title: "Lembrete", shortcut: "/lemb", body: "Oi {{cliente}}! Passando para lembrar do seu horário amanhã às {{hora}}. Te espero! ✨" },
    { title: "Agradecimento", shortcut: "/obg", body: "Obrigada pela visita, {{cliente}}! Espero que tenha amado o resultado 💖 Qualquer coisa é só chamar." },
    { title: "Lista de espera", shortcut: "/espera", body: "Oi {{cliente}}! Abriu um horário {{data}} às {{hora}}. Quer que eu reserve pra você?" },
  ];
  for (const [i, t] of templates.entries()) {
    await prisma.messageTemplate.create({
      data: { company_id: companyId, category: "quick_reply", sort_order: i, is_active: true, ...t },
    });
  }
  console.log(`  ✓ ${templates.length} quick-reply templates`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const income = await prisma.financialTransaction.aggregate({ where: { company_id: companyId, type: "income" }, _sum: { amount: true } });
  const expense = await prisma.financialTransaction.aggregate({ where: { company_id: companyId, type: "expense" }, _sum: { amount: true } });
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const totalIn = Number(income._sum.amount ?? 0);
  const totalOut = Number(expense._sum.amount ?? 0);

  console.log(`\n✅ Seed completo — ${COMPANY_NAME}`);
  console.log(`   Faturamento total : ${brl(totalIn)}`);
  console.log(`   Despesas totais   : ${brl(totalOut)}`);
  console.log(`   Lucro             : ${brl(totalIn - totalOut)}`);
  console.log(`\n   Login dona   : ${OWNER_EMAIL} (senha inalterada)`);
  console.log(`   Atendentes   : ana.demounhas@gmail.com / bruna.demounhas@gmail.com (senha: ${ATTENDANT_PASSWORD})`);
  console.log(`   Company ID   : ${companyId}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
