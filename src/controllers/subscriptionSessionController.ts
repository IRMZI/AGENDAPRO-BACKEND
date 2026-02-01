import type { Request, Response } from "express";
import {
  archiveSession,
  createSubscriptionSession,
  getSessionsWithBookings,
  getSubscriptionSessions,
  markSessionAsCompleted,
  scheduleSession,
  updateSessionStatus,
  updateSubscriptionSession,
} from "../services/subscriptionSessionService.js";

export const getSubscriptionSessionsHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { subscriptionId } = req.params;
    const result = await getSubscriptionSessions(subscriptionId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createSubscriptionSessionHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await createSubscriptionSession(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateSubscriptionSessionHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { sessionId } = req.params;
    const result = await updateSubscriptionSession(sessionId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const markSessionAsCompletedHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { sessionId } = req.params;
    const { completedAt } = req.body || {};
    const result = await markSessionAsCompleted(sessionId, completedAt);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const scheduleSessionHandler = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { scheduledDate, scheduledTime } = req.body || {};
    const result = await scheduleSession(
      sessionId,
      scheduledDate,
      scheduledTime,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getSessionsWithBookingsHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getSessionsWithBookings(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateSessionStatusHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { sessionId } = req.params;
    const { status } = req.body || {};
    const result = await updateSessionStatus(sessionId, status);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const archiveSessionHandler = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const result = await archiveSession(sessionId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
