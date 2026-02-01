import jwt from "jsonwebtoken";

const accessSecret: jwt.Secret = process.env.JWT_ACCESS_SECRET || "";
const refreshSecret: jwt.Secret = process.env.JWT_REFRESH_SECRET || "";
const accessExpiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ||
  "15m") as jwt.SignOptions["expiresIn"];
const refreshExpiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ||
  "30d") as jwt.SignOptions["expiresIn"];

if (!accessSecret || !refreshSecret) {
  // eslint-disable-next-line no-console
  console.warn(
    "JWT secrets are not set. Configure JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.",
  );
}

export type AccessTokenPayload = {
  sub: string;
  email: string;
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
