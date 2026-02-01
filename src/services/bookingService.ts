import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./emailService.js";
import { getCompanyById } from "./companyService.js";
import { BookingStatus } from "@prisma/client";

export const createBooking = async (booking: any) => {
  const company = await prisma.company.findUnique({
    where: { id: booking.company_id },
    select: { is_active: true },
  });

  if (company && !company.is_active) {
    throw new Error("Company account is inactive. Please contact support.");
  }

  const bookingData = {
    ...booking,
    booking_date: booking.booking_date
      ? new Date(booking.booking_date)
      : new Date(),
    status: BookingStatus.pending,
    date_time: booking.booking_date
      ? new Date(`${booking.booking_date}T${booking.booking_time}:00`)
      : null,
  };

  const created = await prisma.booking.create({
    data: bookingData,
  });

  try {
    if (created.client_email?.trim()) {
      const companyInfo = await getCompanyById(created.company_id);
      let attendantName: string | null = null;

      if (created.attendant_id) {
        const attendant = await prisma.attendant.findUnique({
          where: { id: created.attendant_id },
          select: { name: true },
        });
        attendantName = attendant?.name || null;
      }

      await sendEmail({
        to: created.client_email,
        subject: `Agendamento Confirmado - ${companyInfo?.name}`,
        type: "booking_confirmation",
        data: {
          client_name: created.client_name,
          company_name: companyInfo?.name,
          company_phone: companyInfo?.phone,
          service: created.service,
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
    },
    orderBy: [{ booking_date: "asc" }, { booking_time: "asc" }],
  });
};

export const getAvailableTimeSlots = async (
  companyId: string,
  attendantId: string,
  date: string,
  serviceId: string,
) => {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { duration_minutes: true },
  });

  const durationMinutes = service?.duration_minutes || 30;
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
) => {
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status,
      notes: notes || undefined,
      updated_at: new Date(),
    },
  });

  try {
    if (updated.client_email?.trim()) {
      const companyInfo = await getCompanyById(updated.company_id);

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

  return updated;
};

export const archiveBooking = async (bookingId: string) => {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { archived: true, updated_at: new Date() },
  });
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
