import nodemailer from "nodemailer";
import { buildEmailContent } from "./emailTemplates.js";

type SendEmailInput = {
  to: string;
  subject: string;
  type: string;
  data: Record<string, unknown>;
};

export const sendEmail = async ({
  to,
  subject,
  type,
  data,
}: SendEmailInput) => {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;

  if (!smtpUser || !smtpPass) {
    throw new Error("SMTP credentials not configured");
  }

  const fromEmail = process.env.SMTP_FROM || smtpUser;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const { html, text } = buildEmailContent(type, data);

  // White-label: brand the sender by tenant when the caller provides it.
  const brand =
    (typeof data.brand_name === "string" && data.brand_name) ||
    process.env.BRAND_NAME ||
    "My Beauty Calendar";

  const info = await transporter.sendMail({
    from: `${brand} <${fromEmail}>`,
    to,
    subject,
    text,
    html,
  });

  return {
    messageId: info.messageId,
  };
};
