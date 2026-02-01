import type { Request, Response } from "express";
import {
  createClient,
  deleteClient,
  getClientBookings,
  getClientsByCompanyId,
  updateClient,
  upsertClient,
  upsertClientPublic,
} from "../services/clientService.js";

export const getClientsByCompanyHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { companyId } = req.params;
    const result = await getClientsByCompanyId(companyId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createClientHandler = async (req: Request, res: Response) => {
  try {
    const result = await createClient(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const upsertClientHandler = async (req: Request, res: Response) => {
  try {
    const result = await upsertClient(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const upsertClientPublicHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await upsertClientPublic(req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updateClientHandler = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const result = await updateClient(clientId, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deleteClientHandler = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const result = await deleteClient(clientId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const getClientBookingsHandler = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const result = await getClientBookings(clientId);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
