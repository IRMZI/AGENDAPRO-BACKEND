import type { Request, Response } from "express";
import {
  getAttendantWeekdays,
  getCompanyBusinessHours,
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
