import { prisma } from "../lib/prisma.js";

type AvailabilityRequest = {
  companyId: string;
  username: string;
  date: string;
  serviceId?: string;
};

type AvailabilityResponse = {
  date: string;
  is_open_company: boolean;
  is_active_attendant: boolean;
  has_slots: boolean;
  open_time?: string;
  close_time?: string;
};

export const getAvailability = async ({
  companyId,
  username,
  date,
  serviceId,
}: AvailabilityRequest): Promise<AvailabilityResponse> => {
  const targetDate = new Date(date);
  const weekday = targetDate.getDay();

  const attendant = await prisma.attendant.findFirst({
    where: {
      company_id: companyId,
      username,
    },
    select: {
      id: true,
      name: true,
      company_id: true,
      is_active: true,
    },
  });

  if (!attendant) {
    throw new Error("Attendant not found");
  }

  const businessHours = await prisma.companyBusinessHours.findFirst({
    where: {
      company_id: companyId,
      weekday,
    },
    select: {
      is_open: true,
      open_time: true,
      close_time: true,
    },
  });

  let isOpenCompany = false;
  let openTime = "08:00";
  let closeTime = "18:00";

  if (businessHours) {
    isOpenCompany = businessHours.is_open;
    openTime = businessHours.open_time || openTime;
    closeTime = businessHours.close_time || closeTime;
  } else {
    isOpenCompany = true;
  }

  if (!isOpenCompany) {
    return {
      date,
      is_open_company: false,
      is_active_attendant: false,
      has_slots: false,
    };
  }

  const attendantWeekday = await prisma.attendantWeekday.findFirst({
    where: {
      attendant_id: attendant.id,
      weekday,
    },
    select: {
      is_active: true,
      start_time: true,
      end_time: true,
    },
  });

  let isActiveAttendant = false;

  if (attendantWeekday) {
    isActiveAttendant = attendantWeekday.is_active;
    if (attendantWeekday.start_time) openTime = attendantWeekday.start_time;
    if (attendantWeekday.end_time) closeTime = attendantWeekday.end_time;
  } else {
    isActiveAttendant = attendant.is_active;
  }

  if (!isActiveAttendant) {
    return {
      date,
      is_open_company: true,
      is_active_attendant: false,
      has_slots: false,
      open_time: openTime,
      close_time: closeTime,
    };
  }

  let durationMinutes = 30;

  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: {
        id: serviceId,
      },
      select: {
        duration_minutes: true,
      },
    });

    if (service?.duration_minutes) {
      durationMinutes = service.duration_minutes;
    }
  }

  const bookings = await prisma.booking.findMany({
    where: {
      attendant_id: attendant.id,
      booking_date: new Date(date),
      status: {
        in: ["confirmed", "pending", "in_progress"],
      },
    },
    select: {
      booking_time: true,
    },
  });

  const bookedTimes = bookings.map(
    (b: { booking_time: string }) => b.booking_time,
  );

  const hasSlots = calculateHasSlots(
    openTime,
    closeTime,
    durationMinutes,
    bookedTimes,
  );

  return {
    date,
    is_open_company: true,
    is_active_attendant: true,
    has_slots: hasSlots,
    open_time: openTime,
    close_time: closeTime,
  };
};

export const suggestAttendantsForDay = async (
  companyId: string,
  date: string,
  serviceId?: string,
) => {
  const targetDate = new Date(date);
  const weekday = targetDate.getDay();

  let durationMinutes = 30;
  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { duration_minutes: true },
    });
    if (service?.duration_minutes) {
      durationMinutes = service.duration_minutes;
    }
  }

  const businessHours = await prisma.companyBusinessHours.findFirst({
    where: { company_id: companyId, weekday, is_open: true },
    select: { open_time: true, close_time: true },
  });

  if (!businessHours) {
    return [] as {
      attendant_id: string;
      attendant_name: string;
      username: string;
      has_slots: boolean;
    }[];
  }

  const openTime = businessHours.open_time || "08:00";
  const closeTime = businessHours.close_time || "18:00";

  const attendants = await prisma.attendant.findMany({
    where: { company_id: companyId, is_active: true },
    select: { id: true, name: true, username: true },
  });

  const availableAttendants = [] as {
    attendant_id: string;
    attendant_name: string;
    username: string;
    has_slots: boolean;
  }[];

  for (const attendant of attendants) {
    const weekdayConfig = await prisma.attendantWeekday.findFirst({
      where: { attendant_id: attendant.id, weekday, is_active: true },
      select: { start_time: true, end_time: true },
    });

    if (!weekdayConfig) {
      continue;
    }

    const attendantOpen = weekdayConfig.start_time || openTime;
    const attendantClose = weekdayConfig.end_time || closeTime;

    const bookings = await prisma.booking.findMany({
      where: {
        attendant_id: attendant.id,
        booking_date: new Date(date),
        status: { in: ["confirmed", "pending", "in_progress"] },
      },
      select: { booking_time: true },
    });

    const hasSlots = calculateHasSlots(
      attendantOpen,
      attendantClose,
      durationMinutes,
      bookings.map((b: { booking_time: string }) => b.booking_time),
    );

    availableAttendants.push({
      attendant_id: attendant.id,
      attendant_name: attendant.name,
      username: attendant.username,
      has_slots: hasSlots,
    });
  }

  return availableAttendants.sort(
    (a, b) => Number(b.has_slots) - Number(a.has_slots),
  );
};

const calculateHasSlots = (
  openTime: string,
  closeTime: string,
  durationMinutes: number,
  bookedTimes: string[],
): boolean => {
  const parseTime = (time: string): number => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const openMinutes = parseTime(openTime);
  const closeMinutes = parseTime(closeTime);

  const slots: number[] = [];
  for (
    let time = openMinutes;
    time + durationMinutes <= closeMinutes;
    time += 30
  ) {
    slots.push(time);
  }

  const bookedSlots = bookedTimes.map(parseTime);

  for (const slot of slots) {
    const slotEnd = slot + durationMinutes;

    const hasConflict = bookedSlots.some((bookedSlot) => {
      const bookedEnd = bookedSlot + durationMinutes;
      return slot < bookedEnd && slotEnd > bookedSlot;
    });

    if (!hasConflict) {
      return true;
    }
  }

  return false;
};
