import type { Request, Response } from "express";
import {
  checkPreOnboardingToken,
  usePreOnboardingToken,
  getPreOnboardingByToken,
  getAllPreOnboardings,
  createPreOnboarding,
  updatePreOnboarding,
  deletePreOnboarding,
} from "../services/preOnboardingService.js";

export const checkTokenHandler = async (req: Request, res: Response) => {
  try {
    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    const result = await checkPreOnboardingToken(token);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

export const useTokenHandler = async (req: Request, res: Response) => {
  try {
    const { token, userId } = req.body || {};

    if (!token || !userId) {
      return res.status(400).json({ error: "Missing token or userId" });
    }

    const result = await usePreOnboardingToken(token, userId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
};

export const getPreOnboardingByTokenHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { token } = req.params;
    const result = await getPreOnboardingByToken(token);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getAllPreOnboardingsHandler = async (
  _req: Request,
  res: Response,
) => {
  try {
    const result = await getAllPreOnboardings();
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createPreOnboardingHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await createPreOnboarding(req.body);
    return res.status(201).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const updatePreOnboardingHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const result = await updatePreOnboarding(id, req.body);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const deletePreOnboardingHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const result = await deletePreOnboarding(id);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
