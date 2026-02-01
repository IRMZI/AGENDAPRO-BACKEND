import type { Request, Response } from "express";
import {
  createServicePlan,
  deleteServicePlan,
  getServicePlansByCompanyId,
  updateServicePlan,
} from "../services/planService.js";

export const getServicePlansByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getServicePlansByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createServicePlanHandler = async (req: Request, res: Response) => {
  try {
    const result = await createServicePlan(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateServicePlanHandler = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const result = await updateServicePlan(planId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteServicePlanHandler = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const result = await deleteServicePlan(planId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
