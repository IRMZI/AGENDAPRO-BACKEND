import type { Request, Response } from "express";
import {
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  setPasswordWithToken,
  googleLoginExisting,
  exchangeHandoff,
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

export const setPasswordHandler = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Missing token or password" });
    }
    const result = await setPasswordWithToken(
      token,
      password,
      req.headers["user-agent"],
      req.ip,
    );
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

/**
 * Login via Google para usuários que voltam (tela de login do app). Mesma
 * origem da API → devolve os tokens direto (sem handoff). Sem conta → 404
 * GOOGLE_NO_ACCOUNT, e o app manda a pessoa criar o teste na landing.
 */
export const googleHandler = async (req: Request, res: Response) => {
  try {
    const { google_credential, credential } = req.body || {};
    const token = google_credential || credential;
    if (!token) {
      return res.status(400).json({ error: "Missing google credential" });
    }
    const result = await googleLoginExisting(
      token,
      req.headers["user-agent"],
      req.ip,
    );
    return res.status(200).json(result);
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 401;
    if (status >= 500) {
      // Não vaza detalhe interno (ex.: GOOGLE_CLIENT_ID ausente) pro cliente.
      console.error("[auth] google falhou:", error);
      return res
        .status(500)
        .json({ error: "Não foi possível entrar com o Google agora." });
    }
    return res.status(status).json({ error: error.message, code: error.code });
  }
};

/**
 * Troca o handoff (código de uso único, vindo da landing) por uma sessão real.
 * É como a pessoa "aterrissa logada" no app depois do cadastro na landing.
 */
export const handoffExchangeHandler = async (req: Request, res: Response) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Missing code" });
    }
    const result = await exchangeHandoff(code);
    return res.status(200).json(result);
  } catch (error: any) {
    return res
      .status(400)
      .json({ error: error.message || "Handoff inválido", code: "HANDOFF_INVALID" });
  }
};

export const meHandler = async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(200).json({ user: req.user });
};
