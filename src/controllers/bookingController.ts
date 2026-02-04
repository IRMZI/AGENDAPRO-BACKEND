import type { Request, Response } from "express";
import {
  archiveBooking,
  createBooking,
  getAvailableTimeSlots,
  getBookingsByCompanyId,
  getBookingsByDateRange,
  updateBookingStatus,
} from "../services/bookingService.js";

export const createBookingHandler = async (req: Request, res: Response) => {
  try {
    const result = await createBooking(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getBookingsByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getBookingsByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getBookingsByDateRangeHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const { startDate, endDate, attendantId } = req.query as {
      startDate: string;
      endDate: string;
      attendantId?: string;
    };

    const result = await getBookingsByDateRange(
      companyId,
      startDate,
      endDate,
      attendantId,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getAvailableTimeSlotsHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const { attendantId, date, serviceId, totalDuration } = req.query as {
      attendantId: string;
      date: string;
      serviceId: string;
      totalDuration?: string;
    };

    const totalDurationMinutes = totalDuration ? parseInt(totalDuration, 10) : undefined;

    const result = await getAvailableTimeSlots(
      companyId,
      attendantId,
      date,
      serviceId,
      totalDurationMinutes,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateBookingStatusHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { bookingId } = req.params;
    const { status, notes } = req.body || {};
    const result = await updateBookingStatus(bookingId, status, notes);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const archiveBookingHandler = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const result = await archiveBooking(bookingId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
