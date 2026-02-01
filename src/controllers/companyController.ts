import type { Request, Response } from "express";
import {
  createCompany,
  getCompanyById,
  getCompanyByUserId,
  isCompanyActive,
  updateCompany,
  updateCompanyServices,
} from "../services/companyService.js";

export const createCompanyHandler = async (req: Request, res: Response) => {
  try {
    const result = await createCompany(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getCompanyByUserIdHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { userId } = req.params;
    const result = await getCompanyByUserId(userId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getCompanyByIdHandler = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const result = await getCompanyById(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateCompanyServicesHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const { services } = req.body || {};

    if (!Array.isArray(services)) {
      return res.status(400).json({ error: "services must be an array" });
    }

    const result = await updateCompanyServices(companyId, services);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateCompanyHandler = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const result = await updateCompany(companyId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const isCompanyActiveHandler = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const active = await isCompanyActive(userId);
    return res.status(200).json({ active });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
