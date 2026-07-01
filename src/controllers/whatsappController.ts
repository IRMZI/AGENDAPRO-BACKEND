import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  createSession,
  disconnectSession,
  getSessionQr,
  listSessions,
  refreshSessionStatus,
  requireCompanyForUser,
  sendSessionText,
  updateReminderHours,
} from "../services/whatsappService.js";

const handleError = (res: Response, error: any) => {
  const status = error?.statusCode ?? 500;
  return res.status(status).json({ error: error?.message ?? "Internal error" });
};

const uid = (req: AuthenticatedRequest) => req.user?.id ?? "";

export const listSessionsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const sessions = await listSessions(company.id);
    return res.status(200).json({ data: sessions });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const createSessionHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { name } = (req.body ?? {}) as { name?: string };
    const company = await requireCompanyForUser(uid(req));
    const session = await createSession(company.id, name);
    return res.status(201).json({ data: session });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const sessionQrHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const result = await getSessionQr(req.params.id, company.id);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const sessionStatusHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const session = await refreshSessionStatus(req.params.id, company.id);
    return res.status(200).json({ data: session });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const sessionDisconnectHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const session = await disconnectSession(req.params.id, company.id);
    return res.status(200).json({ data: session });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const updateReminderSettingsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { reminder_hours_before } = (req.body ?? {}) as {
      reminder_hours_before?: number;
    };
    const company = await requireCompanyForUser(uid(req));
    const updated = await updateReminderHours(
      company.id,
      Number(reminder_hours_before),
    );
    return res
      .status(200)
      .json({ data: { reminder_hours_before: updated.reminder_hours_before } });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const sessionSendHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { chatId, text } = (req.body ?? {}) as {
      chatId?: string;
      text?: string;
    };
    if (!chatId || !text) {
      return res.status(400).json({ error: "chatId and text are required" });
    }
    const company = await requireCompanyForUser(uid(req));
    const result = await sendSessionText(
      req.params.id,
      company.id,
      chatId,
      text,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return handleError(res, error);
  }
};
