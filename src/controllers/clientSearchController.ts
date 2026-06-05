import type { Request, Response } from "express";
import { searchClientsPublic } from "../services/clientSearchService.js";
import { asyncErrorHandler } from "../middleware/logging.js";

export const searchClientsPublicHandler = asyncErrorHandler(async (
  req: Request,
  res: Response,
) => {
  const startTime = Date.now();
  const requestId = req.requestId || 'unknown';

  const { companyId, searchQuery } = req.body || {};

  if (!companyId || !searchQuery) {
    return res
      .status(400)
      .json({ error: "Missing companyId or searchQuery" });
  }

  const data = await searchClientsPublic(companyId, searchQuery);

  const duration = Date.now() - startTime;
  // Avoid logging the query/results (client PII). Counts/timing only.
  console.log(
    `[CLIENT_SEARCH_${requestId}] ok company=${companyId} results=${data.length} ${duration}ms`,
  );

  return res.status(200).json({ data });
});
