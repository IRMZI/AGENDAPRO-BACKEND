import type { Request, Response } from "express";
import { searchClientsPublic } from "../services/clientSearchService.js";
import { asyncErrorHandler } from "../middleware/logging.js";

export const searchClientsPublicHandler = asyncErrorHandler(async (
  req: Request,
  res: Response,
) => {
  const startTime = Date.now();
  const requestId = req.requestId || 'unknown';
  console.log(`[CLIENT_SEARCH_${requestId}] 🔍 Iniciando busca pública de clientes`);
  console.log(`[CLIENT_SEARCH_${requestId}] 📥 Request body:`, JSON.stringify(req.body, null, 2));
  console.log(`[CLIENT_SEARCH_${requestId}] 📋 Headers:`, {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']?.substring(0, 50),
    'origin': req.headers.origin
  });

  const { companyId, searchQuery } = req.body || {};
  
  console.log(`[CLIENT_SEARCH_${requestId}] 🔍 Parâmetros extraídos:`, {
    companyId: companyId || 'MISSING',
    searchQuery: searchQuery || 'MISSING',
    searchQueryLength: searchQuery?.length || 0
  });

  if (!companyId || !searchQuery) {
    console.log(`[CLIENT_SEARCH_${requestId}] ❌ Validação falhou - parâmetros obrigatórios ausentes`);
    return res
      .status(400)
      .json({ error: "Missing companyId or searchQuery" });
  }

  console.log(`[CLIENT_SEARCH_${requestId}] ✅ Validação passou, chamando service...`);
  const data = await searchClientsPublic(companyId, searchQuery);
  
  const duration = Date.now() - startTime;
  console.log(`[CLIENT_SEARCH_${requestId}] ✅ Busca concluída com sucesso:`, {
    resultCount: data.length,
    duration: `${duration}ms`
  });

  return res.status(200).json({ data });
});
