import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  createAttendant,
  deleteAttendant,
  disableAttendantLogin,
  enableAttendantLogin,
  getAttendantById,
  getAttendantByUsername,
  getAttendantsByCompanyId,
  getPublicAttendantsByCompanyId,
  updateAttendant,
  updateAttendantProfile,
} from "../services/attendantService.js";

export const getAttendantsByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getAttendantsByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Public (no auth): roster for the company booking page (display-safe fields).
export const getPublicAttendantsByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getPublicAttendantsByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createAttendantHandler = async (req: Request, res: Response) => {
  try {
    const result = await createAttendant(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateAttendantHandler = async (req: Request, res: Response) => {
  try {
    const { attendantId } = req.params;
    const result = await updateAttendant(attendantId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteAttendantHandler = async (req: Request, res: Response) => {
  try {
    const { attendantId } = req.params;
    const result = await deleteAttendant(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getMyAttendantHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user?.attendant_id) {
      return res.status(404).json({ error: "Not an attendant" });
    }
    const result = await getAttendantById(req.user.attendant_id);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateMyAttendantHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user?.attendant_id) {
      return res.status(404).json({ error: "Not an attendant" });
    }
    const result = await updateAttendantProfile(
      req.user.attendant_id,
      req.body,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const enableAttendantLoginHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { attendantId } = req.params;
    const { email } = req.body || {};
    const result = await enableAttendantLogin(attendantId, email);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const disableAttendantLoginHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { attendantId } = req.params;
    const result = await disableAttendantLogin(attendantId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getAttendantByUsernameHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId, username } = req.query as {
      companyId: string;
      username: string;
    };
    const result = await getAttendantByUsername(companyId, username);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
