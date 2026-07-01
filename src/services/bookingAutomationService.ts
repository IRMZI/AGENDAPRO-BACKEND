import { prisma } from "../lib/prisma.js";
import { sendAutomatedMessageToPhone } from "./whatsappChatService.js";

// Automações de agendamento por WhatsApp (envio direto). Opt-in: só dispara se
// a empresa tiver um template ATIVO da categoria (booking_confirmation /
// booking_reminder). Lembrete: X horas antes (company.reminder_hours_before).

type BookingRow = {
  id: string;
  company_id: string;
  client_name: string;
  client_phone: string;
  service: string;
  booking_date: Date;
  booking_time: string;
  date_time: Date | null;
};

const renderTpl = (
  body: string,
  vars: Record<string, string | null | undefined>,
) => body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (vars[k] ?? "").toString());

const activeTemplate = (companyId: string, category: string) =>
  prisma.messageTemplate.findFirst({
    where: { company_id: companyId, category, is_active: true },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
  });

// Nome auto-gerado quando um lead vira cliente sem nome real conhecido.
const PLACEHOLDER_NAME = /^cliente whatsapp/i;

// Resolve o nome do cliente para o {{cliente}}: usa o nome do cadastro, mas se
// ele estiver vazio ou for o placeholder "Cliente WhatsApp <id>" (lead criado
// antes do push_name chegar), busca o nome real do contato no WhatsApp.
const resolveClienteName = async (booking: BookingRow): Promise<string> => {
  const raw = (booking.client_name || "").trim();
  if (raw && !PLACEHOLDER_NAME.test(raw)) return raw;
  const last10 = (booking.client_phone || "").replace(/\D/g, "").slice(-10);
  if (last10) {
    const contact = await prisma.whatsappContact.findFirst({
      where: { company_id: booking.company_id, phone: { endsWith: last10 } },
      select: { push_name: true, name: true },
      orderBy: { updated_at: "desc" },
    });
    const better = contact?.push_name?.trim() || contact?.name?.trim();
    if (better) return better;
  }
  return raw;
};

const combineDateTime = (date: Date | null, time: string | null): Date | null => {
  if (!date) return null;
  const d = new Date(date);
  const [h, m] = (time || "00:00").split(":").map((x) => parseInt(x, 10));
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

const buildVars = async (booking: BookingRow) => {
  const company = await prisma.company.findUnique({
    where: { id: booking.company_id },
    select: { name: true, company_nickname: true },
  });
  const bs = await prisma.bookingService.findMany({
    where: { booking_id: booking.id },
    include: { service: { select: { name: true } } },
  });
  const serviceNames =
    bs.map((x) => x.service.name).join(", ") || booking.service || "";
  const clienteName = await resolveClienteName(booking);
  // booking_date é date-only (@db.Date → meia-noite UTC). Formatar em UTC para
  // não voltar um dia em fusos negativos (ex.: BR mostrava 23 em vez de 24).
  const dataStr = new Date(booking.booking_date).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return {
    cliente: clienteName.split(" ")[0] || clienteName || "",
    data: dataStr,
    hora: booking.booking_time || "",
    servico: serviceNames,
    empresa: company?.company_nickname || company?.name || "",
  };
};

// Mensagem automática por STATUS do agendamento. Opt-in: só dispara se a
// empresa tiver um template ativo da categoria `booking_status_<status>`.
// Disparada na criação (status=pending) e a cada mudança de status.
export const maybeSendBookingStatusMessage = async (
  bookingId: string,
  status: string,
) => {
  const booking = (await prisma.booking.findUnique({
    where: { id: bookingId },
  })) as BookingRow | null;
  if (!booking?.client_phone) return;
  const category = `booking_status_${status}`;
  const tpl = await activeTemplate(booking.company_id, category);
  if (!tpl) return;
  const body = renderTpl(tpl.body, await buildVars(booking));
  await sendAutomatedMessageToPhone(
    booking.company_id,
    booking.client_phone,
    body,
    category,
  );
};

// Compat: a criação dispara a automação do status inicial (pending).
export const maybeSendBookingConfirmation = (bookingId: string) =>
  maybeSendBookingStatusMessage(bookingId, "pending");

const markReminderSent = (id: string) =>
  prisma.booking.update({
    where: { id },
    data: { reminder_sent_at: new Date() },
  });

// Tick do scheduler: envia lembretes dos agendamentos que entraram na janela
// "X horas antes" e ainda não foram lembrados. Idempotente via reminder_sent_at.
export const runBookingReminders = async (): Promise<number> => {
  const templates = await prisma.messageTemplate.findMany({
    where: { category: "booking_reminder", is_active: true },
    select: { company_id: true },
  });
  const companyIds = [...new Set(templates.map((t) => t.company_id))];
  let sent = 0;

  for (const companyId of companyIds) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { reminder_hours_before: true },
    });
    const hours = company?.reminder_hours_before ?? 24;
    const now = new Date();
    const until = new Date(now.getTime() + hours * 3_600_000);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const candidates = (await prisma.booking.findMany({
      where: {
        company_id: companyId,
        reminder_sent_at: null,
        archived: false,
        // Lembrete só para agendamentos CONFIRMADOS (pendentes/cancelados não).
        status: "confirmed",
        booking_date: { gte: startOfToday },
      },
      take: 200,
    })) as BookingRow[];

    const tpl = await activeTemplate(companyId, "booking_reminder");
    if (!tpl) continue;

    for (const booking of candidates) {
      const dt = booking.date_time ?? combineDateTime(booking.booking_date, booking.booking_time);
      if (!dt || dt <= now || dt > until) continue;
      try {
        if (!booking.client_phone) {
          await markReminderSent(booking.id);
          continue;
        }
        const body = renderTpl(tpl.body, await buildVars(booking));
        const res = await sendAutomatedMessageToPhone(
          companyId,
          booking.client_phone,
          body,
          "booking_reminder",
        );
        if (res.sent) {
          await markReminderSent(booking.id);
          sent++;
        }
      } catch (err: any) {
        console.error(`[reminder] falhou booking ${booking.id}:`, err?.message);
      }
    }
  }
  return sent;
};
