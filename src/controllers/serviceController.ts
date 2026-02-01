import type { Request, Response } from "express";
import {
  createService,
  deleteService,
  getPlanById,
  getPlans,
  getServicesByCompanyId,
  updateService,
} from "../services/serviceService.js";

export const getServicesByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getServicesByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createServiceHandler = async (req: Request, res: Response) => {
  try {
    const result = await createService(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateServiceHandler = async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;
    const result = await updateService(serviceId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteServiceHandler = async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;
    const result = await deleteService(serviceId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getPlansHandler = async (_req: Request, res: Response) => {
  try {
    const result = await getPlans();
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getPlanByIdHandler = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const result = await getPlanById(planId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
