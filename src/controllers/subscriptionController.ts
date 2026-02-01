import type { Request, Response } from "express";
import {
  createClientSubscription,
  getActiveSubscriptionsByCompanyId,
  getClientSubscriptions,
  getSubscriptionSummary,
  processBookingCompletionWithSubscription,
  updateClientSubscription,
} from "../services/subscriptionService.js";

export const getClientSubscriptionsHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { clientId } = req.params;
    const result = await getClientSubscriptions(clientId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getActiveSubscriptionsByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getActiveSubscriptionsByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createClientSubscriptionHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await createClientSubscription(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateClientSubscriptionHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { subscriptionId } = req.params;
    const result = await updateClientSubscription(subscriptionId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const processBookingCompletionHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { bookingId, subscriptionId } = req.body || {};
    const result = await processBookingCompletionWithSubscription(
      bookingId,
      subscriptionId,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getSubscriptionSummaryHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { subscriptionId } = req.params;
    const result = await getSubscriptionSummary(subscriptionId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
