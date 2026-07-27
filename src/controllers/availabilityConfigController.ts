import type { Request, Response } from "express";
import {
  getAttendantWeekdays,
  getCompanyBusinessHours,
  getSchedulingConfig,
  updateSchedulingConfig,
  upsertAttendantWeekday,
  upsertCompanyBusinessHours,
} from "../services/availabilityConfigService.js";

export const getCompanyBusinessHoursHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getCompanyBusinessHours(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const upsertCompanyBusinessHoursHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await upsertCompanyBusinessHours(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getSchedulingConfigHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getSchedulingConfig(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateSchedulingConfigHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const { slot_interval_minutes } = req.body || {};
    if (typeof slot_interval_minutes !== "number") {
      return res
        .status(400)
        .json({ error: "slot_interval_minutes deve ser um número" });
    }
    const result = await updateSchedulingConfig(companyId, slot_interval_minutes);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getAttendantWeekdaysHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { attendantId } = req.params;
    const result = await getAttendantWeekdays(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const upsertAttendantWeekdayHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await upsertAttendantWeekday(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
