import type { Request, Response } from "express";
import { getHealth } from "../services/healthService.js";

export const healthCheck = (_req: Request, res: Response) => {
  res.status(200).json(getHealth());
};
