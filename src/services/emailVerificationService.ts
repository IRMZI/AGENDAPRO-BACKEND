import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./emailService.js";

// ============================================================================
// Verificação de email por código (6 dígitos) do cadastro do teste grátis.
// ============================================================================
// Substitui o link mágico do WhatsApp como prova de que a pessoa controla o
// email. DB-backed (não em memória): o rate-limiter é por processo e a prod tem
// 2 réplicas — um código emitido por uma réplica precisa valer na outra. O
// código nunca é gravado em claro (bcrypt). Uma linha por email (upsert no
// reenvio). Brute-force barrado por: espaço de 1e6, TTL curto, teto de
// tentativas e o rate-limiter da rota.

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 6;

export class EmailVerificationError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "EmailVerificationError";
    this.status = status;
    this.code = code;
  }
}

const emailKeyOf = (email: string) => email.trim().toLowerCase();

const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const CODE_TTL_MIN = CODE_TTL_MINUTES;

/** Gera + guarda (hash) um código novo e manda por email. */
export const startEmailVerification = async (
  email: string,
  brandName: string,
): Promise<void> => {
  const key = emailKeyOf(email);
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await prisma.emailVerification.upsert({
    where: { email: key },
    create: {
      email: key,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    },
    // Reenvio: novo código zera as tentativas e renova o TTL.
    update: {
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
      updated_at: new Date(),
    },
  });

  // sendEmail LANÇA quando SMTP não está configurado — deixamos propagar de
  // propósito: sem entregar o código, este caminho de cadastro não funciona
  // (ao contrário do WhatsApp de boas-vindas, que é só cosmético).
  await sendEmail({
    to: email,
    subject: `Seu código de verificação — ${brandName}`,
    type: "email_verification_code",
    data: { code, brand_name: brandName, minutes: CODE_TTL_MINUTES },
  });
};

/**
 * Valida o código. Lança EmailVerificationError em qualquer recusa. NÃO queima
 * no acerto de propósito: quem queima é o cadastro DEPOIS de commitar a company
 * (evita "verifiquei mas o create falhou → travei"). Reuso indevido já é barrado
 * pelo dedup do próprio cadastro (o email vira duplicado após a 1ª company).
 */
export const assertEmailVerified = async (
  email: string,
  code: string,
): Promise<void> => {
  const key = emailKeyOf(email);
  const row = await prisma.emailVerification.findUnique({
    where: { email: key },
  });

  if (!row) {
    throw new EmailVerificationError(
      "Não encontramos um código para este e-mail. Peça um novo.",
      400,
      "CODE_NOT_FOUND",
    );
  }
  if (row.expires_at < new Date()) {
    await prisma.emailVerification
      .delete({ where: { email: key } })
      .catch(() => {});
    throw new EmailVerificationError(
      "Código expirado. Peça um novo.",
      400,
      "CODE_EXPIRED",
    );
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new EmailVerificationError(
      "Muitas tentativas. Peça um novo código.",
      429,
      "CODE_LOCKED",
    );
  }

  const ok = await bcrypt.compare(String(code || ""), row.code_hash);
  if (!ok) {
    await prisma.emailVerification.update({
      where: { email: key },
      data: { attempts: { increment: 1 }, updated_at: new Date() },
    });
    throw new EmailVerificationError(
      "Código incorreto. Confira e tente de novo.",
      400,
      "CODE_INCORRECT",
    );
  }
};

/** Limpa a linha após o cadastro concluir (best-effort). */
export const consumeEmailVerification = async (email: string): Promise<void> => {
  await prisma.emailVerification
    .delete({ where: { email: emailKeyOf(email) } })
    .catch(() => {});
};
