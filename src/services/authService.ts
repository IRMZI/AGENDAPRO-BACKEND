import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { resolveUserContext } from "./authContextService.js";

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

  // A brand-new user has no company/attendant yet → admin with null context.
  const context = { role: "admin" as const, company_id: null, attendant_id: null };
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    ...context,
  });
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
    user: { id: user.id, email: user.email, ...context },
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

  const context = await resolveUserContext(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    ...context,
  });
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
    user: { id: user.id, email: user.email, ...context },
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

  // Re-resolve context on every refresh so role/company changes (e.g. an
  // attendant just linked, or deactivated) take effect within the access TTL.
  const context = await resolveUserContext(user.id);
  const newAccessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    ...context,
  });
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

/** Emite sessão + tokens para um usuário já autenticado por outro meio. */
const issueSessionForUser = async (
  userId: string,
  userAgent?: string,
  ipAddress?: string,
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Usuário não encontrado");
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

  const context = await resolveUserContext(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    ...context,
  });
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
    user: { id: user.id, email: user.email, ...context },
    accessToken,
    refreshToken,
  };
};

/**
 * Define a senha a partir de um token de uso único e já loga a pessoa.
 * Usado pela rota pública POST /auth/set-password, que atende DOIS fluxos com
 * o mesmo token opaco:
 *   1. convite de ATENDENTE  (Attendant.invite_token) → vira role "attendant"
 *   2. link mágico do DONO   (User.setup_token, cadastro self-service da LP)
 *      → resolveUserContext acha a Company dele e vira role "admin"
 * Em ambos o token é queimado no uso (single-use).
 */
export const setPasswordWithToken = async (
  token: string,
  password: string,
  userAgent?: string,
  ipAddress?: string,
) => {
  if (!password || password.length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres");
  }

  // ── Fluxo 1: convite de atendente
  const attendant = await prisma.attendant.findUnique({
    where: { invite_token: token },
    select: { id: true, user_id: true, invite_expires_at: true },
  });

  if (attendant) {
    if (!attendant.user_id) {
      throw new Error("Convite inválido");
    }
    if (
      !attendant.invite_expires_at ||
      attendant.invite_expires_at < new Date()
    ) {
      throw new Error("Convite expirado");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: attendant.user_id },
        data: { password_hash: passwordHash, updated_at: new Date() },
      }),
      prisma.attendant.update({
        where: { id: attendant.id },
        data: {
          login_enabled: true,
          invite_token: null,
          invite_expires_at: null,
          updated_at: new Date(),
        },
      }),
    ]);

    return issueSessionForUser(attendant.user_id, userAgent, ipAddress);
  }

  // ── Fluxo 2: link mágico do dono (teste grátis da landing)
  const owner = await prisma.user.findUnique({
    where: { setup_token: token },
    select: { id: true, setup_token_expires_at: true },
  });

  if (!owner) {
    throw new Error("Convite inválido");
  }
  if (!owner.setup_token_expires_at || owner.setup_token_expires_at < new Date()) {
    throw new Error("Convite expirado");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: owner.id },
    data: {
      password_hash: passwordHash,
      setup_token: null,
      setup_token_expires_at: null,
      updated_at: new Date(),
    },
  });

  return issueSessionForUser(owner.id, userAgent, ipAddress);
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
