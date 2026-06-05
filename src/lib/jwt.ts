import jwt from "jsonwebtoken";

const accessSecret: jwt.Secret = process.env.JWT_ACCESS_SECRET || "";
const refreshSecret: jwt.Secret = process.env.JWT_REFRESH_SECRET || "";
const accessExpiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ||
  "15m") as jwt.SignOptions["expiresIn"];
const refreshExpiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ||
  "30d") as jwt.SignOptions["expiresIn"];

if (!accessSecret || !refreshSecret) {
  const message =
    "JWT secrets are not set. Configure JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.";
  // Fail closed in production: empty secrets mean forgeable / unverifiable
  // tokens, so refuse to boot rather than run insecurely.
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  // eslint-disable-next-line no-console
  console.warn(message);
}

export type UserRole = "admin" | "attendant";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  // Identity context — optional so legacy tokens (issued before this change)
  // still verify. requireAuth defaults role to "admin" when absent.
  role?: UserRole;
  company_id?: string | null;
  attendant_id?: string | null;
};

export type RefreshTokenPayload = {
  sub: string;
  sessionId: string;
};

export const signAccessToken = (payload: AccessTokenPayload) => {
  return jwt.sign(payload, accessSecret, { expiresIn: accessExpiresIn });
};

export const signRefreshToken = (payload: RefreshTokenPayload) => {
  return jwt.sign(payload, refreshSecret, { expiresIn: refreshExpiresIn });
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, accessSecret) as AccessTokenPayload;
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, refreshSecret) as RefreshTokenPayload;
};
