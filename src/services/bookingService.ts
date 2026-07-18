import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./emailService.js";
import { assertCompanyBookable, getCompanyById } from "./companyService.js";
import { recordBookingFinancials } from "./financialService.js";
import { getBrandName } from "./tenantService.js";
import {
  maybeSendBookingConfirmation,
  maybeSendBookingStatusMessage,
} from "./bookingAutomationService.js";
import { sendPushToUser } from "./pushService.js";
import { BookingStatus, type PaymentMethod } from "@prisma/client";

/**
 * Guard against cross-tenant reference injection on the public booking route:
 * every related id must resolve to a row owned by the same company. Throws on
 * the first mismatch (and on a non-existent id).
 */
async function assertBelongsToCompany(
  companyId: string,
  refs: {
    attendantId?: string | null;
    clientId?: string | null;
    subscriptionId?: string | null;
    serviceId?: string | null;
    serviceIds?: string[] | null;
  },
) {
  if (refs.attendantId) {
    const row = await prisma.attendant.findUnique({
      where: { id: refs.attendantId },
      select: { company_id: true },
    });
    if (!row || row.company_id !== companyId) {
      throw new Error("Invalid attendant for this company");
    }
  }
  if (refs.clientId) {
    const row = await prisma.client.findUnique({
      where: { id: refs.clientId },
      select: { company_id: true },
    });
    if (!row || row.company_id !== companyId) {
      throw new Error("Invalid client for this company");
    }
  }
  if (refs.subscriptionId) {
    const row = await prisma.clientSubscription.findUnique({
      where: { id: refs.subscriptionId },
      select: { company_id: true },
    });
    if (!row || row.company_id !== companyId) {
      throw new Error("Invalid subscription for this company");
    }
  }
  const serviceIds = [
    ...(refs.serviceId ? [refs.serviceId] : []),
    ...(Array.isArray(refs.serviceIds) ? refs.serviceIds : []),
  ];
  if (serviceIds.length > 0) {
    const count = await prisma.service.count({
      where: { id: { in: serviceIds }, company_id: companyId },
    });
    if (count !== new Set(serviceIds).size) {
      throw new Error("Invalid service for this company");
    }
  }
}

export const createBooking = async (booking: any) => {
  if (!booking?.company_id) {
    throw new Error("company_id is required");
  }

  // Public endpoint: reject unknown companies (no spamming arbitrary ids),
  // inactive accounts e trial expirado — regra única em companyService.
  await assertCompanyBookable(booking.company_id);

  const companyId: string = booking.company_id;

  // Reject any cross-tenant reference: every related id supplied by the
  // (unauthenticated) caller must belong to the same company.
  await assertBelongsToCompany(companyId, {
    attendantId: booking.attendant_id,
    clientId: booking.client_id,
    subscriptionId: booking.subscription_id,
    serviceId: booking.service_id,
    serviceIds: booking.service_ids,
  });

  // Extrair service_ids se existir (novo formato com múltiplos serviços)
  const { service_ids, ...bookingData } = booking;

  const finalBookingData = {
    ...bookingData,
    booking_date: booking.booking_date
      ? new Date(booking.booking_date)
      : new Date(),
    status: BookingStatus.pending,
    date_time: booking.booking_date
      ? new Date(`${booking.booking_date}T${booking.booking_time}:00`)
      : null,
  };

  // Usar transação para criar booking e relacionamentos de serviços
  const created = await prisma.$transaction(async (tx) => {
    // Criar o booking
    const newBooking = await tx.booking.create({
      data: finalBookingData,
    });

    // Se service_ids foi fornecido (novo formato), criar relacionamentos na tabela BookingService
    if (service_ids && Array.isArray(service_ids) && service_ids.length > 0) {
      // Congela o preço de cada serviço no momento do agendamento.
      const services = await tx.service.findMany({
        where: { id: { in: service_ids } },
        select: { id: true, price: true },
      });
      const priceMap = new Map(services.map((s) => [s.id, s.price]));
      const bookingServices = service_ids.map((serviceId: string) => ({
        booking_id: newBooking.id,
        service_id: serviceId,
        price_snapshot: priceMap.get(serviceId) ?? null,
      }));

      await tx.bookingService.createMany({
        data: bookingServices,
      });
    }
    // Se service_id foi fornecido (formato antigo), manter compatibilidade
    else if (booking.service_id) {
      const svc = await tx.service.findUnique({
        where: { id: booking.service_id },
        select: { price: true },
      });
      await tx.bookingService.create({
        data: {
          booking_id: newBooking.id,
          service_id: booking.service_id,
          price_snapshot: svc?.price ?? null,
        },
      });
    }

    return newBooking;
  });

  try {
    if (created.client_email?.trim()) {
      const companyInfo = await getCompanyById(created.company_id);
      const brand = await getBrandName(companyInfo?.tenant_id);
      let attendantName: string | null = null;

      if (created.attendant_id) {
        const attendant = await prisma.attendant.findUnique({
          where: { id: created.attendant_id },
          select: { name: true },
        });
        attendantName = attendant?.name || null;
      }

      // Buscar os serviços associados para o email
      const bookingServices = await prisma.bookingService.findMany({
        where: { booking_id: created.id },
        include: {
          service: { select: { name: true } },
        },
      });

      const serviceNames = bookingServices
        .map((bs: any) => bs.service.name)
        .join(", ");

      await sendEmail({
        to: created.client_email,
        subject: `Agendamento Confirmado - ${companyInfo?.name}`,
        type: "booking_confirmation",
        data: {
          brand_name: brand,
          client_name: created.client_name,
          company_name: companyInfo?.name,
          company_phone: companyInfo?.phone,
          service: serviceNames || created.service, // Usar nomes dos serviços ou fallback para campo service
          booking_date: created.booking_date,
          booking_time: created.booking_time,
          attendant_name: attendantName,
        },
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send confirmation email:", error);
  }

  // Confirmação por WhatsApp (opt-in: só dispara se a empresa tiver um template
  // booking_confirmation ativo e um WhatsApp conectado). Não bloqueia a criação.
  try {
    await maybeSendBookingConfirmation(created.id);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send WhatsApp confirmation:", error);
  }

  // Push (PWA) para o dono da empresa: avisa em tempo real do novo agendamento
  // mesmo com o app fechado. Best-effort — nunca bloqueia a criação.
  try {
    const companyInfo = await getCompanyById(created.company_id);
    const ownerUserId = (companyInfo as { user_id?: string } | null)?.user_id;
    if (ownerUserId) {
      // Nome da atendente (se houver vínculo).
      let attendantName: string | null = null;
      if (created.attendant_id) {
        const a = await prisma.attendant.findUnique({
          where: { id: created.attendant_id },
          select: { name: true },
        });
        attendantName = a?.name || null;
      }

      // Serviço(s) do agendamento.
      const bs = await prisma.bookingService.findMany({
        where: { booking_id: created.id },
        include: { service: { select: { name: true } } },
      });
      const serviceNames =
        bs.map((x: any) => x.service?.name).filter(Boolean).join(", ") ||
        created.service ||
        null;

      // Data em pt-BR. booking_date é gravado à meia-noite UTC, então formata
      // em UTC para não "voltar" um dia dependendo do fuso do servidor.
      const rawDate = created.booking_date;
      let dateLabel = "";
      if (rawDate) {
        const d = new Date(rawDate as any);
        dateLabel = isNaN(d.getTime())
          ? String(rawDate)
          : d.toLocaleDateString("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              timeZone: "UTC",
            });
      }
      const time = created.booking_time || "";
      const when = [dateLabel, time && `às ${time}`].filter(Boolean).join(" ");

      // Linha 1: cliente • data às hora | Linha 2: serviço · com atendente.
      const line1 = [created.client_name || "Cliente", when]
        .filter(Boolean)
        .join(" • ");
      const line2 = [serviceNames, attendantName && `com ${attendantName}`]
        .filter(Boolean)
        .join(" · ");
      const body = [line1, line2].filter(Boolean).join("\n");

      await sendPushToUser(ownerUserId, {
        title: "Novo agendamento",
        body,
        url: "/agenda",
        tag: `booking-${created.id}`,
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send push notification:", error);
  }

  return created;
};

export const getBookingsByCompanyId = async (companyId: string) => {
  return prisma.booking.findMany({
    where: { company_id: companyId },
    include: {
      attendant: { select: { id: true, name: true, username: true } },
      service_rel: {
        select: { id: true, name: true, duration_minutes: true, price: true },
      },
      bookingServices: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              duration_minutes: true,
              price: true,
            },
          },
        },
      },
    },
    orderBy: { booking_date: "desc" },
  });
};

export const getBookingsByDateRange = async (
  companyId: string,
  startDate: string,
  endDate: string,
  attendantId?: string,
) => {
  return prisma.booking.findMany({
    where: {
      company_id: companyId,
      booking_date: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
      ...(attendantId ? { attendant_id: attendantId } : {}),
    },
    include: {
      attendant: { select: { id: true, name: true, username: true } },
      service_rel: {
        select: { id: true, name: true, duration_minutes: true, price: true },
      },
      bookingServices: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              duration_minutes: true,
              price: true,
            },
          },
        },
      },
    },
    orderBy: [{ booking_date: "asc" }, { booking_time: "asc" }],
  });
};

export const getAvailableTimeSlots = async (
  companyId: string,
  attendantId: string,
  date: string,
  serviceId: string,
  totalDurationMinutes?: number, // Novo parâmetro opcional para duração total
) => {
  await assertCompanyBookable(companyId);
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { duration_minutes: true },
  });

  // Usar totalDurationMinutes se fornecido, senão usar duração do serviço
  const durationMinutes = totalDurationMinutes || service?.duration_minutes || 30;
  const targetDate = new Date(date);
  const weekday = targetDate.getDay();

  const businessHours = await prisma.companyBusinessHours.findFirst({
    where: { company_id: companyId, weekday },
    select: { is_open: true, open_time: true, close_time: true },
  });

  let openTime = "08:00";
  let closeTime = "18:00";
  let isOpen = true;

  if (businessHours) {
    isOpen = businessHours.is_open;
    openTime = businessHours.open_time || openTime;
    closeTime = businessHours.close_time || closeTime;
  }

  if (!isOpen) {
    return [] as string[];
  }

  const attendantWeekday = await prisma.attendantWeekday.findFirst({
    where: { attendant_id: attendantId, weekday },
    select: { is_active: true, start_time: true, end_time: true },
  });

  if (attendantWeekday) {
    if (!attendantWeekday.is_active) {
      return [] as string[];
    }

    openTime = attendantWeekday.start_time || openTime;
    closeTime = attendantWeekday.end_time || closeTime;
  }

  const bookings = await prisma.booking.findMany({
    where: {
      attendant_id: attendantId,
      booking_date: new Date(date),
      status: {
        in: [
          BookingStatus.confirmed,
          BookingStatus.pending,
          BookingStatus.in_progress,
        ],
      },
    },
    select: { booking_time: true },
  });

  const allSlots = generateTimeSlots(openTime, closeTime, 30);
  const bookedTimes = bookings.map(
    (b: { booking_time: string }) => b.booking_time,
  );

  const today = new Date();
  const selectedDate = new Date(`${date}T00:00:00`);
  const isToday = selectedDate.toDateString() === today.toDateString();

  const now = new Date();
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

  const availableSlots = allSlots.filter((slot) => {
    if (isToday) {
      const [hours, minutes] = slot.split(":").map(Number);
      const slotTimeMinutes = hours * 60 + minutes;

      if (slotTimeMinutes <= currentTimeMinutes + 5) {
        return false;
      }
    }

    return !hasTimeConflict(
      slot,
      durationMinutes,
      bookedTimes,
      durationMinutes,
    );
  });

  return availableSlots;
};

export const updateBookingStatus = async (
  bookingId: string,
  status: BookingStatus,
  notes?: string,
  opts?: { total_amount?: number | null; payment_method?: PaymentMethod | null },
) => {
  // Status anterior, p/ só disparar a automação de WhatsApp quando muda de fato.
  const prev = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true },
  });
  const updated = await prisma.$transaction(async (tx) => {
    if (status === BookingStatus.completed) {
      // Optimistic guard: only the first transition to completed records
      // financials, killing duplicate income/commission on double-clicks.
      const transition = await tx.booking.updateMany({
        where: { id: bookingId, status: { not: BookingStatus.completed } },
        data: {
          status,
          notes: notes || undefined,
          updated_at: new Date(),
          completed_at: new Date(),
          ...(opts?.total_amount != null
            ? { total_amount: opts.total_amount }
            : {}),
          ...(opts?.payment_method ? { payment_method: opts.payment_method } : {}),
        },
      });

      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new Error("Booking not found");

      if (transition.count === 1) {
        await recordBookingFinancials(tx, {
          id: booking.id,
          company_id: booking.company_id,
          attendant_id: booking.attendant_id,
          total_amount: booking.total_amount,
          payment_method: booking.payment_method,
          booking_date: booking.booking_date,
          client_name: booking.client_name,
          service: booking.service,
        });
      }
      return booking;
    }

    return tx.booking.update({
      where: { id: bookingId },
      data: { status, notes: notes || undefined, updated_at: new Date() },
    });
  });

  try {
    if (updated.client_email?.trim()) {
      const companyInfo = await getCompanyById(updated.company_id);
      const brand = await getBrandName(companyInfo?.tenant_id);

      let emailStatus: "confirmed" | "cancelled" | "completed" | null = null;
      let statusText = "";

      if (status === BookingStatus.confirmed) {
        emailStatus = "confirmed";
        statusText = "Confirmado";
      } else if (status === BookingStatus.cancelled) {
        emailStatus = "cancelled";
        statusText = "Cancelado";
      } else if (status === BookingStatus.completed) {
        emailStatus = "completed";
        statusText = "Concluído";
      }

      if (emailStatus) {
        await sendEmail({
          to: updated.client_email,
          subject: `Agendamento ${statusText} - ${companyInfo?.name}`,
          type: "booking_status_update",
          data: {
            brand_name: brand,
            client_name: updated.client_name,
            company_name: companyInfo?.name,
            company_phone: companyInfo?.phone,
            service: updated.service,
            booking_date: updated.booking_date,
            booking_time: updated.booking_time,
            new_status: emailStatus,
            notes,
          },
        });
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send status update email:", error);
  }

  // Automação de WhatsApp por status (opt-in: template booking_status_<status>
  // ativo). Só dispara quando o status realmente muda. Não bloqueia.
  try {
    if (prev && prev.status !== status) {
      await maybeSendBookingStatusMessage(bookingId, status);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to send WhatsApp status automation:", error);
  }

  return updated;
};

export const archiveBooking = async (bookingId: string) => {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { archived: true, updated_at: new Date() },
  });
};

/** Edit an existing booking (client/service/attendant/date/time/notes). */
export const updateBooking = async (bookingId: string, data: any) => {
  return prisma.$transaction(async (tx) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.attendant_id !== undefined)
      patch.attendant_id = data.attendant_id || null;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.client_name !== undefined) patch.client_name = data.client_name;
    if (data.client_phone !== undefined) patch.client_phone = data.client_phone;
    if (data.client_email !== undefined) patch.client_email = data.client_email;
    if (data.client_id !== undefined) patch.client_id = data.client_id || null;
    if (data.service !== undefined) patch.service = data.service;
    if (data.booking_time !== undefined) patch.booking_time = data.booking_time;
    if (data.booking_date !== undefined)
      patch.booking_date = new Date(data.booking_date);
    if (data.service_id !== undefined)
      patch.service_id = data.service_id || null;

    await tx.booking.update({ where: { id: bookingId }, data: patch });

    const current = await tx.booking.findUnique({ where: { id: bookingId } });
    if (current?.booking_date && current.booking_time) {
      const ds = current.booking_date.toISOString().slice(0, 10);
      await tx.booking.update({
        where: { id: bookingId },
        data: { date_time: new Date(`${ds}T${current.booking_time}:00`) },
      });
    }

    // If the service changed, rebuild the join row with a fresh price snapshot.
    if (data.service_id !== undefined) {
      await tx.bookingService.deleteMany({ where: { booking_id: bookingId } });
      if (data.service_id) {
        const svc = await tx.service.findUnique({
          where: { id: data.service_id },
          select: { price: true },
        });
        await tx.bookingService.create({
          data: {
            booking_id: bookingId,
            service_id: data.service_id,
            price_snapshot: svc?.price ?? null,
          },
        });
      }
    }

    return tx.booking.findUnique({ where: { id: bookingId } });
  });
};

/** Hard-delete a booking. BookingService rows cascade; ledger entries are kept. */
export const deleteBooking = async (bookingId: string) => {
  await prisma.booking.delete({ where: { id: bookingId } });
  return { id: bookingId };
};

const hasTimeConflict = (
  slotTime: string,
  slotDuration: number,
  bookedTimes: string[],
  bookedDuration: number = 30,
): boolean => {
  const parseTime = (time: string): number => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const slotStart = parseTime(slotTime);
  const slotEnd = slotStart + slotDuration;

  return bookedTimes.some((bookedTime) => {
    const bookedStart = parseTime(bookedTime);
    const bookedEnd = bookedStart + bookedDuration;

    return slotStart < bookedEnd && slotEnd > bookedStart;
  });
};

const generateTimeSlots = (
  openTime: string,
  closeTime: string,
  interval: number = 30,
): string[] => {
  const slots: string[] = [];
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);

  let currentMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  while (currentMinutes < closeMinutes) {
    const hours = Math.floor(currentMinutes / 60);
    const minutes = currentMinutes % 60;
    slots.push(
      `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    );
    currentMinutes += interval;
  }

  return slots;
};
