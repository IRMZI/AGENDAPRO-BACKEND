import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./emailService.js";
import { getBrandName } from "./tenantService.js";

export const getAttendantsByCompanyId = async (companyId: string) => {
  return prisma.attendant.findMany({
    where: { company_id: companyId, is_active: true },
    orderBy: { name: "asc" },
  });
};

export const createAttendant = async (data: any) => {
  // Whitelist creatable fields — never let the body set login/identity columns.
  const { name, username, email, phone, company_id } = data ?? {};
  return prisma.attendant.create({
    data: { name, username, email, phone, company_id, is_active: true },
  });
};

const clampPercent = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error("commission_percent inválido");
  return Math.min(100, Math.max(0, n));
};

export const updateAttendant = async (attendantId: string, data: any) => {
  // Whitelist editable fields. Login/identity columns are managed only by the
  // dedicated invite/enable flow, never by a generic update.
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (data?.name !== undefined) patch.name = data.name;
  if (data?.email !== undefined) patch.email = data.email;
  if (data?.phone !== undefined) patch.phone = data.phone;
  if (data?.is_active !== undefined) patch.is_active = data.is_active;
  if (data?.commission_enabled !== undefined)
    patch.commission_enabled = Boolean(data.commission_enabled);
  if (data?.commission_percent !== undefined)
    patch.commission_percent = clampPercent(data.commission_percent);

  return prisma.attendant.update({
    where: { id: attendantId },
    data: patch,
  });
};

export const deleteAttendant = async (attendantId: string) => {
  // Soft-delete + revoke any login so a removed attendant can no longer sign in.
  const attendant = await prisma.attendant.findUnique({
    where: { id: attendantId },
    select: { user_id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.attendant.update({
      where: { id: attendantId },
      data: {
        is_active: false,
        login_enabled: false,
        invite_token: null,
        invite_expires_at: null,
        updated_at: new Date(),
      },
    });
    if (attendant?.user_id) {
      await tx.session.updateMany({
        where: { user_id: attendant.user_id, revoked_at: null },
        data: { revoked_at: new Date(), updated_at: new Date() },
      });
    }
  });
  return { id: attendantId, is_active: false };
};

export const getAttendantById = async (attendantId: string) => {
  return prisma.attendant.findUnique({ where: { id: attendantId } });
};

export const getAttendantByUsername = async (
  companyId: string,
  username: string,
) => {
  // Public endpoint (used by the booking pages). Return ONLY display-safe
  // fields — never invite_token, user_id, email/phone or commission data,
  // which would enable account takeover / PII harvesting.
  return prisma.attendant.findFirst({
    where: { company_id: companyId, username },
    select: {
      id: true,
      company_id: true,
      name: true,
      username: true,
      is_active: true,
    },
  });
};

/**
 * Enable (or re-send) an attendant login. Creates/links a User, ensures a
 * UserProfile with role=attendant, links Attendant.user_id, and emails a
 * one-time set-password link. Idempotent: re-running rotates the invite token.
 */
export const enableAttendantLogin = async (
  attendantId: string,
  emailOverride?: string,
) => {
  const attendant = await prisma.attendant.findUnique({
    where: { id: attendantId },
    select: {
      id: true,
      name: true,
      email: true,
      user_id: true,
      company_id: true,
      company: { select: { name: true, tenant_id: true } },
    },
  });
  if (!attendant) throw new Error("Atendente não encontrado");

  const email = (emailOverride || attendant.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Informe um email para enviar o convite de acesso");
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Find-or-create the login user.
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      // Unusable placeholder hash until the attendant sets their password.
      const placeholder = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
      user = await tx.user.create({
        data: { email, password_hash: placeholder },
      });
    }

    await tx.userProfile.upsert({
      where: {
        user_id_company_id: {
          user_id: user.id,
          company_id: attendant.company_id,
        },
      },
      create: {
        user_id: user.id,
        company_id: attendant.company_id,
        role: "attendant",
        full_name: attendant.name,
      },
      update: { role: "attendant", full_name: attendant.name },
    });

    await tx.attendant.update({
      where: { id: attendant.id },
      data: {
        user_id: user.id,
        email,
        login_enabled: true,
        invite_token: token,
        invite_expires_at: expires,
        updated_at: new Date(),
      },
    });
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const inviteUrl = `${frontendUrl.replace(/\/$/, "")}/definir-senha/${token}`;
  const brand = await getBrandName(attendant.company.tenant_id);

  try {
    await sendEmail({
      to: email,
      subject: `Seu acesso à agenda — ${attendant.company.name}`,
      type: "attendant_invite",
      data: {
        brand_name: brand,
        attendant_name: attendant.name,
        company_name: attendant.company.name,
        invite_url: inviteUrl,
      },
    });
  } catch (err) {
    // Don't fail the whole operation if SMTP hiccups — the owner can resend,
    // and the invite link is also returned for manual sharing.
    // eslint-disable-next-line no-console
    console.error("Failed to send attendant invite email:", err);
  }

  return { email, login_enabled: true, invite_url: inviteUrl };
};

export const disableAttendantLogin = async (attendantId: string) => {
  const attendant = await prisma.attendant.findUnique({
    where: { id: attendantId },
    select: { user_id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.attendant.update({
      where: { id: attendantId },
      data: {
        login_enabled: false,
        invite_token: null,
        invite_expires_at: null,
        updated_at: new Date(),
      },
    });
    if (attendant?.user_id) {
      await tx.session.updateMany({
        where: { user_id: attendant.user_id, revoked_at: null },
        data: { revoked_at: new Date(), updated_at: new Date() },
      });
    }
  });
  return { login_enabled: false };
};
