import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  getFinancialSummary,
  getRevenueSeries,
  listTransactions,
  createTransaction,
  deleteTransaction,
  getPaymentMethods,
  upsertPaymentMethod,
  getCurrentCashRegister,
  openCashRegister,
  closeCashRegister,
  getPendingCommissionsByAttendant,
  listCommissions,
  payAttendantCommissions,
  listPayouts,
} from "../services/financialService.js";

const q = (req: AuthenticatedRequest, key: string) =>
  typeof req.query[key] === "string" ? (req.query[key] as string) : undefined;

export const getSummaryHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await getFinancialSummary(
      req.params.companyId,
      q(req, "start"),
      q(req, "end"),
    );
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const getReportsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const start = q(req, "start");
    const end = q(req, "end");
    if (!start || !end) {
      return res.status(400).json({ error: "start e end são obrigatórios" });
    }
    const data = await getRevenueSeries(req.params.companyId, start, end);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const listTransactionsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const type = q(req, "type") as "income" | "expense" | undefined;
    const data = await listTransactions(req.params.companyId, {
      type,
      start: q(req, "start"),
      end: q(req, "end"),
    });
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const createTransactionHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { company_id, ...rest } = req.body || {};
    const data = await createTransaction(company_id, {
      ...rest,
      created_by: req.user?.id,
    });
    return res.status(201).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const deleteTransactionHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const companyId = q(req, "companyId");
    if (!companyId) {
      return res.status(400).json({ error: "companyId é obrigatório" });
    }
    const data = await deleteTransaction(companyId, req.params.id);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const getPaymentMethodsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await getPaymentMethods(req.params.companyId);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const upsertPaymentMethodHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { company_id, method, is_enabled, fee_percent } = req.body || {};
    const data = await upsertPaymentMethod(company_id, method, {
      is_enabled,
      fee_percent,
    });
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const getCashRegisterHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await getCurrentCashRegister(req.params.companyId);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const openCashRegisterHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { company_id, opening_float } = req.body || {};
    const data = await openCashRegister(
      company_id,
      opening_float ?? 0,
      req.user?.id,
    );
    return res.status(201).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const closeCashRegisterHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { company_id, closing_total } = req.body || {};
    const data = await closeCashRegister(
      company_id,
      req.params.registerId,
      closing_total ?? 0,
    );
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const getPendingCommissionsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await getPendingCommissionsByAttendant(req.params.companyId);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const listCommissionsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await listCommissions(req.params.companyId, {
      attendantId: q(req, "attendantId"),
      status: q(req, "status"),
    });
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const payCommissionsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { company_id, attendant_id } = req.body || {};
    const data = await payAttendantCommissions(company_id, attendant_id);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
};

export const listPayoutsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = await listPayouts(req.params.companyId);
    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};
