import type { Request, Response } from "express";
import { searchClientsPublic } from "../services/clientSearchService.js";

export const searchClientsPublicHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId, searchQuery } = req.body || {};

    if (!companyId || !searchQuery) {
      return res
        .status(400)
        .json({ error: "Missing companyId or searchQuery" });
    }

    const data = await searchClientsPublic(companyId, searchQuery);

    return res.status(200).json({ data });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};
