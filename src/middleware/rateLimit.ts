import type { Request, Response, NextFunction } from "express";

/**
 * Tiny in-memory, per-IP rate limiter — no external dependency.
 *
 * Intended for abuse mitigation on unauthenticated/public endpoints (login
 * brute-force, booking/email/lead spam). In-memory by design: counters reset on
 * restart and are per-process. For a multi-instance deployment, move this to a
 * shared store (Redis). Good enough as a first line of defense.
 */
type Bucket = { count: number; resetAt: number };

const clientIp = (req: Request): string =>
  (req.ip ||
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ||
    req.socket?.remoteAddress ||
    "unknown").trim();

export const rateLimit = (opts: {
  windowMs: number;
  max: number;
  message?: string;
}) => {
  const { windowMs, max, message = "Muitas requisições. Tente novamente em instantes." } =
    opts;
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientIp(req);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    // Opportunistic cleanup so the map doesn't grow unbounded.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
    }

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    return next();
  };
};

// Shared presets.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
});

export const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
});

// Image uploads are authed but still capped so a compromised token can't spam
// the bucket. Generous enough for editing a profile + a batch of services.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Muitos envios de imagem. Aguarde um instante e tente novamente.",
});
