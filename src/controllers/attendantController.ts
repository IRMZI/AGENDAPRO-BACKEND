import type { Request, Response } from "express";
import {
  createAttendant,
  deleteAttendant,
  getAttendantByUsername,
  getAttendantsByCompanyId,
  updateAttendant,
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
