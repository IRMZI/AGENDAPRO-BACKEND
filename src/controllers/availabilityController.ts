import type { Request, Response } from "express";
import {
  getAvailability,
  suggestAttendantsForDay,
} from "../services/availabilityService.js";

export const getTodayAvailabilityHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId, username, date, serviceId } = req.body || {};

    if (!companyId || !username || !date) {
      return res
        .status(400)
        .json({ error: "Missing companyId, username, or date" });
    }

    const result = await getAvailability({
      companyId,
      username,
      date,
      serviceId,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    if (error.message === "Attendant not found") {
      return res.status(404).json({ error: "Attendant not found" });
    }

    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

export const suggestAttendantsHandler = async (req: Request, res: Response) => {
  try {
    const { companyId, date, serviceId } = req.body || {};

    if (!companyId || !date) {
      return res.status(400).json({ error: "Missing companyId or date" });
    }

    const result = await suggestAttendantsForDay(companyId, date, serviceId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};
