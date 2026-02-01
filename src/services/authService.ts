import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt.js";

const parseDurationToMs = (value: string): number => {
  const match = value.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return 30 * 24 * 60 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
};

const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

const buildSessionExpiry = () => {
  const ms = parseDurationToMs(refreshExpiresIn);
  return new Date(Date.now() + ms);
};

export const registerUser = async (
  email: string,
  password: string,
  userAgent?: string,
  ipAddress?: string,
) => {
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    throw new Error("Email already registered");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password_hash: passwordHash,
    },
  });

  const session = await prisma.session.create({
    data: {
      user_id: user.id,
      refresh_token_hash: "",
      user_agent: userAgent,
      ip_address: ipAddress,
      expires_at: buildSessionExpiry(),
    },
  });

  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken({
    sub: user.id,
    sessionId: session.id,
  });
  const refreshHash = await bcrypt.hash(refreshToken, 10);

  await prisma.session.update({
    where: { id: session.id },
    data: { refresh_token_hash: refreshHash },
  });

  return {
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken,
  };
};

export const loginUser = async (
  email: string,
  password: string,
  userAgent?: string,
  ipAddress?: string,
) => {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error("Invalid credentials");
  }

  const session = await prisma.session.create({
    data: {
      user_id: user.id,
      refresh_token_hash: "",
      user_agent: userAgent,
      ip_address: ipAddress,
      expires_at: buildSessionExpiry(),
    },
  });

  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const refreshToken = signRefreshToken({
    sub: user.id,
    sessionId: session.id,
  });
  const refreshHash = await bcrypt.hash(refreshToken, 10);

  await prisma.session.update({
    where: { id: session.id },
    data: { refresh_token_hash: refreshHash },
  });

  return {
    user: { id: user.id, email: user.email },
    accessToken,
    refreshToken,
  };
};

export const refreshSession = async (refreshToken: string) => {
  const payload = verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { id: payload.sessionId },
  });

  if (!session || session.user_id !== payload.sub) {
    throw new Error("Invalid refresh token");
  }

  if (session.revoked_at || session.expires_at < new Date()) {
    throw new Error("Session expired");
  }

  const matches = await bcrypt.compare(
    refreshToken,
    session.refresh_token_hash,
  );
  if (!matches) {
    throw new Error("Invalid refresh token");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const newAccessToken = signAccessToken({ sub: user.id, email: user.email });
  const newRefreshToken = signRefreshToken({
    sub: user.id,
    sessionId: session.id,
  });

  const newRefreshHash = await bcrypt.hash(newRefreshToken, 10);

  await prisma.session.update({
    where: { id: session.id },
    data: {
      refresh_token_hash: newRefreshHash,
      updated_at: new Date(),
      expires_at: buildSessionExpiry(),
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

export const logoutSession = async (refreshToken: string) => {
  const payload = verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { id: payload.sessionId },
  });

  if (!session || session.user_id !== payload.sub) {
    return;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { revoked_at: new Date(), updated_at: new Date() },
  });
};
