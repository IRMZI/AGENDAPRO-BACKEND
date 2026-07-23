/**
 * Demo seed — nail studio filled for UGC/demo recording.
 *
 * Two interchangeable studios (see PRESETS): the UGC creator picks whichever
 * name she's comfortable putting on camera. They are independent companies —
 * seeding one never touches the other.
 *
 * Creates the owner user + company if they don't exist, then fills:
 *   • 6 months of history (bookings, income, expenses, commissions, payouts)
 *   • 3 months of future bookings (agenda cheia para gravar)
 *   • plans + client subscriptions, cash registers, payment fees
 *
 * Bookings are packed per attendant/day respecting each service's duration and
 * a lunch break, so the calendar never shows two overlapping cards for the same
 * attendant — the existing demo seed picks random times and does overlap.
 *
 * Idempotent: WIPES that company's data first (scoped strictly by company_id)
 * and re-seeds. It never touches other companies, and it refuses to run if the
 * resolved company isn't the demo one.
 *
 * Run:  cd Backend && npm run seed:erika     (or seed:nina)
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

/**
 * Each preset is a self-contained studio identity. `key` also namespaces the
 * attendant login e-mails — User.email and Attendant.user_id are both unique,
 * so two studios must never derive the same address.
 */
const PRESETS = {
  erika: {
    key: "erika",
    email: "erikaastudio@gmail.com",
    name: "ERIKA A STUDIO",
    owner: "Erika Almeida",
    ownerUsername: "erika",
  },
  nina: {
    key: "nina",
    email: "ninaastudio@gmail.com",
    name: "NINA A STUDIO",
    owner: "Nina Alves",
    ownerUsername: "nina",
  },
} as const;

const presetKey = (process.argv[2] || "erika") as keyof typeof PRESETS;
const preset = PRESETS[presetKey];
if (!preset) {
  throw new Error(
    `Unknown preset "${presetKey}". Use one of: ${Object.keys(PRESETS).join(", ")}`,
  );
}

const OWNER_EMAIL = preset.email;
const OWNER_PASSWORD = "demo123";
const COMPANY_NAME = preset.name;
const TENANT_SLUG = "mbc";

const HISTORY_DAYS = 183; // ~6 months back
const FUTURE_DAYS = 92; // ~3 months forward

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
/** "Patrícia" → "patricia" — strips combining accents for demo e-mails. */
const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Payment mix weighted like a real BR salon (pix-heavy). */
const payment = () => {
  const r = Math.random();
  if (r < 0.45) return "pix";
  if (r < 0.7) return "credit";
  if (r < 0.9) return "debit";
  return "cash";
};

type Svc = { id: string; name: string; duration_minutes: number; price: number };

/**
 * createMany in batches. A single INSERT binds one parameter per column per
 * row, and Postgres caps a statement at 65535 parameters — ~3k bookings × 19
 * columns blows straight through that, so never send the whole array at once.
 */
async function createManyChunked(
  model: { createMany: (a: { data: any[] }) => Promise<unknown> },
  data: any[],
  size = 500,
) {
  for (let i = 0; i < data.length; i += size) {
    await model.createMany({ data: data.slice(i, i + size) });
  }
}

/**
 * Greedily packs one attendant's day: walks the timeline from opening, placing
 * services back-to-back with small gaps and jumping the lunch window. Returns
 * non-overlapping slots, so the calendar reads cleanly on camera.
 */
function packDay(services: Svc[], target: number) {
  const out: { startMin: number; service: Svc }[] = [];
  let cursor = OPEN_MIN + pick([0, 0, 15, 30]);
  let guard = 0;
  while (out.length < target && cursor < CLOSE_MIN && guard++ < 40) {
    const service = pick(services);
    const dur = service.duration_minutes;
    // Don't start something that would run into lunch — resume after it.
    if (cursor < LUNCH_END && cursor + dur > LUNCH_START) {
      cursor = LUNCH_END;
      continue;
    }
    if (cursor + dur > CLOSE_MIN) break;
    out.push({ startMin: cursor, service });
    cursor += dur + pick([0, 0, 10, 15, 30]);
  }
  return out;
}

/** Bookings per attendant per day — trends upward toward today (growth curve). */
function targetFor(offset: number, isSaturday: boolean) {
  let base: number;
  if (offset < 0) {
    const monthsAgo = Math.floor(-offset / 30.4);
    if (monthsAgo >= 4) base = randInt(2, 3);
    else if (monthsAgo >= 2) base = randInt(3, 4);
    else base = randInt(3, 5);
  } else {
    const monthsAhead = Math.floor(offset / 30.4);
    base = monthsAhead === 0 ? randInt(3, 5) : monthsAhead === 1 ? randInt(3, 4) : randInt(2, 4);
  }
  return isSaturday ? base + 1 : base;
}

async function main() {
  // ── 0. Tenant + owner user + company (create-or-reuse) ───────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found`);

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    create: { email: OWNER_EMAIL, password_hash: passwordHash },
    update: { password_hash: passwordHash },
  });

  const existing = await prisma.company.findUnique({ where: { user_id: owner.id } });
  if (existing && existing.name !== COMPANY_NAME) {
    throw new Error(
      `Refusing to seed: user ${OWNER_EMAIL} already owns "${existing.name}", not "${COMPANY_NAME}".`,
    );
  }

  const company = existing
    ? await prisma.company.update({
        where: { id: existing.id },
        data: {
          name: COMPANY_NAME,
          company_nickname: COMPANY_NAME,
          is_active: true,
          subscription_status: "active",
          first_login_completed: true,
        },
      })
    : await prisma.company.create({
        data: {
          user_id: owner.id,
          tenant_id: tenant.id,
          name: COMPANY_NAME,
          company_nickname: COMPANY_NAME,
          email: OWNER_EMAIL,
          phone: "11987654321",
          primary_phone: "11987654321",
          business_type: "Estúdio de unhas",
          company_size: "SMALL",
          business_model: "studio",
          max_attendants: 4,
          is_active: true,
          subscription_status: "active",
          first_login_completed: true,
          show_unassigned_services: true,
        },
      });
  const companyId = company.id;
  console.log(`▶ Seeding ${company.name} (${companyId}) · tenant=${TENANT_SLUG}`);

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
    const created = await prisma.service.create({
      data: { company_id: companyId, is_active: true, ...s },
    });
    services.push({
      id: created.id,
      name: created.name,
      duration_minutes: created.duration_minutes,
      price: Number(created.price ?? 0),
    });
  }
  console.log(`  ✓ ${services.length} services`);

  // ── 5. Attendants (the owner takes no commission; the rest do) ───────────
  // Logins are namespaced by preset key: User.email is unique and an Attendant
  // maps to at most one user, so a shared address would break the second studio.
  const login = (n: string) => `${n}.${preset.key}astudio@gmail.com`;
  const attendantDefs = [
    { name: preset.owner, username: preset.ownerUsername, commission: null as number | null, login: null as string | null },
    { name: "Beatriz Nunes", username: "beatriz", commission: 40, login: login("beatriz") },
    { name: "Camila Rocha", username: "camila", commission: 35, login: login("camila") },
    { name: "Duda Martins", username: "duda", commission: 30, login: null },
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
        email: a.login ?? `${a.username}@${preset.key}astudio.demo`,
        phone: `1199${randInt(1000000, 9999999)}`, is_active: true, user_id: userId,
        login_enabled: !!a.login, commission_enabled: a.commission != null, commission_percent: a.commission,
      },
    });
    for (let wd = 1; wd <= 6; wd++) {
      await prisma.attendantWeekday.create({
        data: { attendant_id: att.id, weekday: wd, is_active: true, start_time: "09:00", end_time: "19:00" },
      });
    }
    // Every attendant does every service (keeps the public page fully populated).
    for (const s of services) {
      await prisma.serviceAttendant.create({
        data: { service_id: s.id, attendant_id: att.id },
      });
    }
    attendants.push(att);
  }
  console.log(`  ✓ ${attendants.length} attendants (2 com login: senha "${OWNER_PASSWORD}")`);

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

  // ── 7. Bookings + financials (6 months back → 3 months forward) ──────────
  const bookingsData: any[] = [];
  const bookingServicesData: any[] = [];
  const incomeData: any[] = [];
  const commissionRows: any[] = [];
  const commissionData: { attendant_id: string; amount: number; date: Date }[] = [];
  let completedCount = 0;
  let futureCount = 0;

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    const date = dayOffset(offset);
    const wd = date.getUTCDay();
    if (wd === 0) continue; // closed Sundays

    for (const attendant of attendants) {
      const slots = packDay(services, targetFor(offset, wd === 6));
      for (const { startMin, service } of slots) {
        const client = pick(clients);
        const time = hhmm(startMin);

        let status: string;
        if (offset < 0) {
          status = chance(0.88) ? "completed" : chance(0.6) ? "cancelled" : "no_show";
        } else if (offset === 0) {
          // Today reads like a live day: mornings done, midday running, rest ahead.
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

  // ── 8. Recurring monthly operating expenses (last 7 months) ──────────────
  const now = new Date();
  const monthlyExpenses = [
    { category: "rent", description: "Aluguel do estúdio", amount: 1800, day: 5 },
    { category: "utilities", description: "Energia, água e internet", amount: 610, day: 10 },
    { category: "products", description: "Reposição de esmaltes e materiais", amount: 780, day: 14 },
    { category: "marketing", description: "Anúncios (Instagram/Google)", amount: 350, day: 20 },
    { category: "supplies", description: "Materiais descartáveis", amount: 290, day: 24 },
  ];
  const expenseRows: any[] = [];
  for (let k = 0; k <= 6; k++) {
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
  console.log(`  ✓ ${payoutCount} monthly commission payouts (mês atual pendente)`);

  // ── 11. Cash register: one open today + two closed (history) ─────────────
  for (const back of [7, 3]) {
    const closed = dayOffset(-back);
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
    const startedAt = dayOffset(-randInt(10, 60));
    const sub = await prisma.clientSubscription.create({
      data: {
        client_id: subClient.id, plan_id: plan.id, company_id: companyId,
        sessions_remaining: total - used, sessions_used: used, status: "active",
        start_date: startedAt, next_booking_date: dayOffset(randInt(3, 20)),
        last_booking_date: dayOffset(-randInt(1, 9)),
        amount_paid: Number(plan.price), payment_status: "paid",
      },
    });
    for (let n = 1; n <= total; n++) {
      const done = n <= used;
      await prisma.subscriptionSession.create({
        data: {
          subscription_id: sub.id, company_id: companyId, session_number: n,
          status: done ? "completed" : "scheduled",
          scheduled_date: done ? dayOffset(-randInt(1, 50)) : dayOffset(randInt(3, 40)),
          scheduled_time: pick(["09:00", "10:30", "14:00", "15:30", "17:00"]),
          completed_at: done ? dayOffset(-randInt(1, 50)) : null,
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
  const income = await prisma.financialTransaction.aggregate({
    where: { company_id: companyId, type: "income" }, _sum: { amount: true },
  });
  const expense = await prisma.financialTransaction.aggregate({
    where: { company_id: companyId, type: "expense" }, _sum: { amount: true },
  });
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const totalIn = Number(income._sum.amount ?? 0);
  const totalOut = Number(expense._sum.amount ?? 0);

  console.log(`\n✅ Seed completo — ${COMPANY_NAME}`);
  console.log(`   Faturamento total : ${brl(totalIn)}`);
  console.log(`   Despesas totais   : ${brl(totalOut)}`);
  console.log(`   Lucro             : ${brl(totalIn - totalOut)}`);
  console.log(`\n   Login dona   : ${OWNER_EMAIL} (senha: ${OWNER_PASSWORD})`);
  console.log(`   Atendentes   : ${login("beatriz")} / ${login("camila")} (senha: ${OWNER_PASSWORD})`);
  console.log(`   Company ID   : ${companyId}`);
  console.log(`   Link público : /book/${companyId}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
