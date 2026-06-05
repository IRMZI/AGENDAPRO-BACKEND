import type { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { resolveCallerCompanyId, type AuthenticatedRequest } from "./auth.js";

/**
 * Per-resource ownership guards for routes that carry a resource id but no
 * companyId (e.g. /bookings/:bookingId/status). Each loads the row, reads its
 * company_id and 403s when it does not match the caller's token company.
 *
 * Use AFTER requireAuth. Returns 404 when the resource does not exist so we
 * don't leak existence across tenants.
 */
type CompanyResolver = (
  req: AuthenticatedRequest,
) => Promise<string | null | undefined>;

const guard =
  (resolve: CompanyResolver) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const companyId = await resolve(req);
      if (!companyId) {
        return res.status(404).json({ error: "Not found" });
      }
      const callerCompanyId = await resolveCallerCompanyId(req);
      if (!callerCompanyId || callerCompanyId !== companyId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return next();
    } catch {
      return res.status(500).json({ error: "Authorization check failed" });
    }
  };

export const ownsBooking = guard(async (req) => {
  const row = await prisma.booking.findUnique({
    where: { id: req.params.bookingId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsAttendant = guard(async (req) => {
  const row = await prisma.attendant.findUnique({
    where: { id: req.params.attendantId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsClient = guard(async (req) => {
  const row = await prisma.client.findUnique({
    where: { id: req.params.clientId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsService = guard(async (req) => {
  const row = await prisma.service.findUnique({
    where: { id: req.params.serviceId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsServicePlan = guard(async (req) => {
  const row = await prisma.plan.findUnique({
    where: { id: req.params.planId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsSubscription = guard(async (req) => {
  const row = await prisma.clientSubscription.findUnique({
    where: { id: req.params.subscriptionId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsSubscriptionSession = guard(async (req) => {
  const row = await prisma.subscriptionSession.findUnique({
    where: { id: req.params.sessionId },
    select: { company_id: true },
  });
  return row?.company_id;
});

export const ownsAttendantLink = guard(async (req) => {
  const row = await prisma.attendantLink.findUnique({
    where: { id: req.params.linkId },
    select: { attendant: { select: { company_id: true } } },
  });
  return row?.attendant.company_id;
});

export const ownsAttendantBanner = guard(async (req) => {
  const row = await prisma.attendantBanner.findUnique({
    where: { id: req.params.bannerId },
    select: { attendant: { select: { company_id: true } } },
  });
  return row?.attendant.company_id;
});

/** For routes that carry attendant_id in the body (e.g. weekdays/links/banners upsert). */
export const ownsAttendantByBody = guard(async (req) => {
  const attendantId = (req.body as { attendant_id?: string } | undefined)
    ?.attendant_id;
  if (!attendantId) return null;
  const row = await prisma.attendant.findUnique({
    where: { id: attendantId },
    select: { company_id: true },
  });
  return row?.company_id;
});

/* ─────────────────────────────────────────────────────────────
   Attendant self-scoping: an attendant may only touch their OWN
   data. Admins bypass these (they manage the whole company).
   ───────────────────────────────────────────────────────────── */

/** Attendant may only act on :attendantId === their own. */
export const requireOwnAttendantParam = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role === "attendant" && req.params.attendantId !== req.user.attendant_id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

/** Attendant may only act when body.attendant_id === their own. */
export const requireOwnAttendantBody = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const bodyAttendantId = (req.body as { attendant_id?: string } | undefined)
    ?.attendant_id;
  if (req.user.role === "attendant" && bodyAttendantId !== req.user.attendant_id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

/** Force the bookings list to the attendant's own bookings (attendants only). */
export const scopeAttendantBookings = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  if (req.user?.role === "attendant") {
    req.query.attendantId = req.user.attendant_id ?? "__none__";
  }
  return next();
};

/** An attendant may only mutate a booking that is assigned to them. */
export const restrictBookingToOwnAttendant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role !== "attendant") return next();
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.bookingId },
    select: { attendant_id: true },
  });
  if (!booking) return res.status(404).json({ error: "Not found" });
  if (booking.attendant_id !== req.user.attendant_id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};
