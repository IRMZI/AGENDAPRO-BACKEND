import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type UserRole } from "../lib/jwt.js";
import { resolveUserContext } from "../services/authContextService.js";
import { getCompanyAccessCached, isBookable } from "../services/companyService.js";

export type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    company_id: string | null;
    attendant_id: string | null;
  };
};

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.role) {
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role as UserRole,
        company_id: payload.company_id ?? null,
        attendant_id: payload.attendant_id ?? null,
      };
    } else {
      // Legacy token without identity claims: resolve the REAL context from the
      // DB instead of assuming admin (which would be a privilege escalation).
      const ctx = await resolveUserContext(payload.sub);
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: ctx.role,
        company_id: ctx.company_id,
        attendant_id: ctx.attendant_id,
      };
    }
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

/** Allow only the given roles. Use after requireAuth on owner-only routes. */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };

const extractCompanyId = (req: AuthenticatedRequest): string | null => {
  const fromParams = req.params?.companyId;
  const fromBody = (req.body as { company_id?: string } | undefined)?.company_id;
  const fromQuery = req.query?.companyId;
  return (
    (typeof fromParams === "string" && fromParams) ||
    (typeof fromBody === "string" && fromBody) ||
    (typeof fromQuery === "string" && fromQuery) ||
    null
  );
};

/**
 * Resolve the caller's effective company id. Uses the token claim when present;
 * otherwise falls back to a DB lookup and heals req.user in place. The fallback
 * keeps sessions issued before identity claims existed (legacy tokens) working
 * without a forced logout — they would otherwise carry company_id=null and 403.
 */
export const resolveCallerCompanyId = async (
  req: AuthenticatedRequest,
): Promise<string | null> => {
  if (!req.user) return null;
  if (req.user.company_id) return req.user.company_id;
  const ctx = await resolveUserContext(req.user.id);
  req.user.role = ctx.role;
  req.user.company_id = ctx.company_id;
  req.user.attendant_id = ctx.attendant_id;
  return ctx.company_id;
};

/**
 * Ensure the caller may act on the companyId carried by the request
 * (params.companyId, body.company_id or query.companyId). Both owners and
 * attendants are scoped to a single company_id baked into their token.
 *
 * If no companyId is present on the request, defers to per-resource ownership
 * guards (see middleware/ownership.ts).
 */
export const requireCompanyAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const companyId = extractCompanyId(req);
  if (!companyId) {
    return next();
  }
  const callerCompanyId = await resolveCallerCompanyId(req);
  if (!callerCompanyId || callerCompanyId !== companyId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

/**
 * Bloqueia a empresa com teste expirado ou conta suspensa. Roda DEPOIS de
 * requireAuth em toda rota da empresa.
 *
 * Gate na company do TOKEN (resolveCallerCompanyId), nunca no companyId do
 * request: metade das rotas (ex.: PATCH /bookings/:id) não carrega companyId.
 * Sem company (signup que ainda não criou empresa) passa direto — é o que
 * mantém o fluxo signup → criar empresa funcionando.
 *
 * 402 e não 403: 403 já é usado por requireRole/requireCompanyAccess/ownership,
 * e o frontend precisa distinguir "sem permissão" de "conta bloqueada".
 */
export const requireActiveCompany = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const companyId = await resolveCallerCompanyId(req);
  if (!companyId) return next();

  const access = await getCompanyAccessCached(companyId);
  if (!access) return next(); // deixa o handler devolver 404

  if (!isBookable(access)) {
    return res.status(402).json({
      error:
        access.subscription_status === "expired"
          ? "Seu período de teste terminou."
          : "Esta conta está temporariamente suspensa.",
      code: "TRIAL_EXPIRED",
      subscription_status: access.subscription_status,
    });
  }
  return next();
};

/**
 * Internal/platform-only guard. Used for operator actions that a company owner
 * must NOT perform from the app (e.g. flipping module permissions, which is
 * tied to the plan). Caller must send `x-internal-secret` matching
 * INTERNAL_ADMIN_SECRET. Fails closed when the env var is not configured.
 */
export const requireInternalSecret = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const secret = process.env.INTERNAL_ADMIN_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!secret || provided !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};

/** Ensure :userId in the route matches the authenticated user. */
export const requireSelfUserParam = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.params?.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
};
