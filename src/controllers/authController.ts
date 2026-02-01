import type { Request, Response } from "express";
import {
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
} from "../services/authService.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";

export const signUpHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const result = await registerUser(
      email,
      password,
      req.headers["user-agent"],
      req.ip,
    );

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

export const signInHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const result = await loginUser(
      email,
      password,
      req.headers["user-agent"],
      req.ip,
    );

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({ error: error.message });
  }
};

export const refreshHandler = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      return res.status(400).json({ error: "Missing refreshToken" });
    }

    const result = await refreshSession(refreshToken);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({ error: error.message });
  }
};

export const logoutHandler = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      return res.status(400).json({ error: "Missing refreshToken" });
    }

    await logoutSession(refreshToken);
    return res.status(204).send();
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to logout" });
  }
};

export const meHandler = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(200).json({ user: req.user });
};
