import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { vapidPublicKey, pushConfigured } from "../lib/webpush.js";
import {
  saveSubscription,
  deleteSubscription,
  sendPushToUser,
} from "../services/pushService.js";

/** Chave pública VAPID + flag de disponibilidade — o frontend precisa dela
 *  para chamar PushManager.subscribe(). */
export const getPublicKeyHandler = (
  _req: AuthenticatedRequest,
  res: Response,
) => {
  return res
    .status(200)
    .json({ data: { publicKey: vapidPublicKey, enabled: pushConfigured } });
};

/** Registra a inscrição de push do device do usuário autenticado. */
export const subscribeHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    // Aceita tanto { subscription: {...} } quanto o objeto cru.
    const sub = (req.body as any)?.subscription ?? req.body;
    await saveSubscription(
      req.user.id,
      sub,
      req.headers["user-agent"] as string | undefined,
    );
    return res.status(201).json({ data: { ok: true } });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

/** Remove a inscrição (usuário desligou as notificações neste device). */
export const unsubscribeHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const endpoint = (req.body as { endpoint?: string })?.endpoint;
    if (!endpoint) {
      return res.status(400).json({ error: "endpoint é obrigatório" });
    }
    await deleteSubscription(endpoint);
    return res.status(200).json({ data: { ok: true } });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};

/** Dispara uma notificação de teste para o próprio usuário (validar o setup). */
export const testPushHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const sent = await sendPushToUser(req.user.id, {
      title: "Notificações ativadas 🎉",
      body: "Pronto! Você receberá avisos de novos agendamentos por aqui.",
      url: "/agenda",
      tag: "push-test",
    });
    return res.status(200).json({ data: { sent } });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
};
