import { BookingStatus } from "@prisma/client";

/**
 * Motor único de conflito/disponibilidade da agenda.
 *
 * Duas regras que TODO cálculo de horário precisa respeitar (e que antes
 * estavam divergentes/erradas em cada serviço):
 *
 *  1. STATUS: só ocupa a agenda quem está de fato pendente/em andamento.
 *     Um agendamento `completed`/`cancelled`/`no_show` NÃO bloqueia o slot
 *     (a profissional já terminou / a cliente não vem).
 *
 *  2. DURAÇÃO REAL: cada agendamento existente ocupa a SUA própria duração
 *     (override do agendamento → duração do serviço → 30), e não a duração
 *     do serviço que se está tentando marcar agora. Era esse o bug que fazia
 *     horários válidos sumirem ("só aparece 16:30 em vez de 15:30").
 */

export const DEFAULT_DURATION_MINUTES = 30;

/** Status que ocupam a agenda. Os demais liberam o horário. */
export const BLOCKING_STATUSES: BookingStatus[] = [
  BookingStatus.pending,
  BookingStatus.confirmed,
  BookingStatus.in_progress,
];

/** "HH:MM" -> minutos desde a meia-noite. */
export const parseHHMM = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** minutos desde a meia-noite -> "HH:MM". */
export const formatHHMM = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

/**
 * Um agendamento existente, no formato mínimo que o motor precisa.
 * `service_rel.duration_minutes` é o fallback para linhas antigas cujo
 * `duration_minutes` ainda é NULL (pré-migração).
 */
export type ExistingBooking = {
  booking_time: string;
  duration_minutes: number | null;
  service_rel: { duration_minutes: number } | null;
};

/** Prisma select reaproveitável para carregar agendamentos p/ conflito. */
export const conflictBookingSelect = {
  booking_time: true,
  duration_minutes: true,
  service_rel: { select: { duration_minutes: true } },
} as const;

/** Duração real (min) que um agendamento existente ocupa na agenda. */
export const bookingDurationMinutes = (b: ExistingBooking): number =>
  b.duration_minutes ??
  b.service_rel?.duration_minutes ??
  DEFAULT_DURATION_MINUTES;

/**
 * Sobreposição de [aStart, aStart+aDur) com [bStart, bStart+bDur).
 * Encostar (13:00–13:30 seguido de 13:30–14:00) NÃO é conflito — é o que
 * permite encaixar clientes justinho, um atrás do outro.
 */
export const rangesOverlap = (
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
): boolean => aStart < bStart + bDuration && aStart + aDuration > bStart;

/**
 * Um candidato [time, time+duration) colide com algum agendamento ativo?
 * `existing` já deve vir filtrado por BLOCKING_STATUSES.
 */
export const conflictsWithExisting = (
  time: string,
  durationMinutes: number,
  existing: ExistingBooking[],
): boolean => {
  const start = parseHHMM(time);
  return existing.some((b) =>
    rangesOverlap(
      start,
      durationMinutes,
      parseHHMM(b.booking_time),
      bookingDurationMinutes(b),
    ),
  );
};

/**
 * Grade de horários sugeridos: começa em `openTime`, anda de `intervalMinutes`
 * em `intervalMinutes` e só sugere horários que caibam inteiros até `closeTime`.
 * A profissional ainda pode digitar qualquer horário fora da grade.
 */
export const generateGrid = (
  openTime: string,
  closeTime: string,
  durationMinutes: number,
  intervalMinutes: number,
): string[] => {
  const open = parseHHMM(openTime);
  const close = parseHHMM(closeTime);
  const step = Math.max(5, intervalMinutes || DEFAULT_DURATION_MINUTES);
  const slots: string[] = [];
  for (let t = open; t + durationMinutes <= close; t += step) {
    slots.push(formatHHMM(t));
  }
  return slots;
};
