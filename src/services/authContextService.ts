import { prisma } from "../lib/prisma.js";
import type { UserRole } from "../lib/jwt.js";

export interface UserContext {
  role: UserRole;
  company_id: string | null;
  attendant_id: string | null;
}

/**
 * Resolve the identity context for a user at login/refresh time.
 *
 * - Owner of a company (Company.user_id is @unique) → admin scoped to that company.
 * - Linked to an active attendant (Attendant.user_id) → attendant scoped to that
 *   attendant + its company.
 * - Otherwise (e.g. a brand-new signup that hasn't created a company yet) →
 *   admin with no company, so the existing signup → create-company flow keeps working.
 *
 * This is the single source of truth for the JWT claims and /auth/me.
 */
export const resolveUserContext = async (
  userId: string,
): Promise<UserContext> => {
  const company = await prisma.company.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  if (company) {
    return { role: "admin", company_id: company.id, attendant_id: null };
  }

  const attendant = await prisma.attendant.findFirst({
    where: { user_id: userId, is_active: true, login_enabled: true },
    select: { id: true, company_id: true },
  });
  if (attendant) {
    return {
      role: "attendant",
      company_id: attendant.company_id,
      attendant_id: attendant.id,
    };
  }

  return { role: "admin", company_id: null, attendant_id: null };
};
