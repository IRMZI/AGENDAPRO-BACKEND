import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "../services/messageTemplateService.js";
import { requireCompanyForUser } from "../services/whatsappService.js";

const handleError = (res: Response, error: any) => {
  const status = error?.statusCode ?? 500;
  return res.status(status).json({ error: error?.message ?? "Internal error" });
};

const uid = (req: AuthenticatedRequest) => req.user?.id ?? "";

export const listTemplatesHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const category = (req.query.category as string | undefined) || undefined;
    const templates = await listTemplates(company.id, category);
    return res.status(200).json({ data: templates });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const createTemplateHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const tpl = await createTemplate(company.id, req.body ?? {});
    return res.status(201).json({ data: tpl });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const updateTemplateHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const tpl = await updateTemplate(req.params.id, company.id, req.body ?? {});
    return res.status(200).json({ data: tpl });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const deleteTemplateHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const result = await deleteTemplate(req.params.id, company.id);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return handleError(res, error);
  }
};
