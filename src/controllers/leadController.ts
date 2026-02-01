import type { Request, Response } from "express";
import { createLead, getLeads } from "../services/leadService.js";

export const createLeadHandler = async (req: Request, res: Response) => {
  try {
    const result = await createLead(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getLeadsHandler = async (_req: Request, res: Response) => {
  try {
    const result = await getLeads();
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
