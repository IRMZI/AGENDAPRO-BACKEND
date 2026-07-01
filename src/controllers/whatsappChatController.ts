import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  createClientFromConversation,
  deleteConversation,
  getClientWhatsappLinks,
  getConversationBookings,
  linkConversationToClient,
  listConversations,
  listMessages,
  markConversationSeen,
  processWebhookEvent,
  reactToMessage,
  sendConversationMessage,
  updateConversationContactName,
} from "../services/whatsappChatService.js";
import { requireCompanyForUser } from "../services/whatsappService.js";

const handleError = (res: Response, error: any) => {
  const status = error?.statusCode ?? 500;
  return res.status(status).json({ error: error?.message ?? "Internal error" });
};

const uid = (req: AuthenticatedRequest) => req.user?.id ?? "";

// ----------- Webhook (sem JWT - secret-based) -----------

export const webhookHandler = async (req: Request, res: Response) => {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  const received = req.headers["x-webhook-secret"];
  // Fail closed: without a configured secret the webhook would accept forged
  // events from anyone, so refuse in production. Dev (no secret set) stays open
  // for local testing.
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error("[webhook] WHATSAPP_WEBHOOK_SECRET not configured — rejecting");
      return res.status(503).json({ error: "webhook not configured" });
    }
  } else if (received !== expected) {
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  const { wahaSessionId } = req.params;
  try {
    await processWebhookEvent(wahaSessionId, req.body);
    return res.status(204).end();
  } catch (err) {
    console.error("[webhook] erro processando:", err);
    // 500 para o WAHA re-tentar: uma falha transitória (ex.: blip do banco) não
    // deve descartar a mensagem silenciosamente. O WAHA re-tenta com backoff
    // limitado, então não há risco de loop infinito.
    return res.status(500).json({ ok: false });
  }
};

// ----------- Chat endpoints (JWT) -----------

export const listConversationsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const sessionId = (req.query.sessionId as string | undefined) || undefined;
    const conversations = await listConversations(company.id, sessionId);
    return res.status(200).json({ data: conversations });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const clientWhatsappLinksHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const links = await getClientWhatsappLinks(company.id);
    return res.status(200).json({ data: links });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const listMessagesHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : undefined;
    const before = (req.query.before as string | undefined) || undefined;
    const messages = await listMessages(req.params.convId, company.id, {
      limit,
      before,
    });
    return res.status(200).json({ data: messages });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const sendMessageHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { body, replyTo } = (req.body ?? {}) as {
      body?: string;
      replyTo?: string;
    };
    if (!body || !body.trim()) {
      return res.status(400).json({ error: "body is required" });
    }
    const company = await requireCompanyForUser(uid(req));
    const message = await sendConversationMessage(
      req.params.convId,
      company.id,
      body.trim(),
      replyTo,
    );
    return res.status(201).json({ data: message });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const reactMessageHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { waMessageId, emoji } = (req.body ?? {}) as {
      waMessageId?: string;
      emoji?: string;
    };
    if (!waMessageId || typeof emoji !== "string") {
      return res
        .status(400)
        .json({ error: "waMessageId and emoji are required" });
    }
    const company = await requireCompanyForUser(uid(req));
    const result = await reactToMessage(
      req.params.convId,
      company.id,
      waMessageId,
      emoji,
    );
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const markSeenHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const conv = await markConversationSeen(req.params.convId, company.id);
    return res.status(200).json({ data: conv });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const linkClientHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { clientId } = (req.body ?? {}) as { clientId?: string | null };
    const company = await requireCompanyForUser(uid(req));
    const conv = await linkConversationToClient(
      req.params.convId,
      company.id,
      clientId ?? null,
    );
    return res.status(200).json({ data: conv });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const deleteConversationHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const result = await deleteConversation(req.params.convId, company.id);
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const conversationBookingsHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const company = await requireCompanyForUser(uid(req));
    const bookings = await getConversationBookings(req.params.convId, company.id);
    return res.status(200).json({ data: bookings });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const updateContactNameHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { name } = (req.body ?? {}) as { name?: string };
    const company = await requireCompanyForUser(uid(req));
    const conv = await updateConversationContactName(
      req.params.convId,
      company.id,
      name ?? "",
    );
    return res.status(200).json({ data: conv });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const createClientFromConversationHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { name, email } = (req.body ?? {}) as {
      name?: string;
      email?: string;
    };
    const company = await requireCompanyForUser(uid(req));
    const client = await createClientFromConversation(
      req.params.convId,
      company.id,
      { name, email },
    );
    return res.status(201).json({ data: client });
  } catch (error: any) {
    return handleError(res, error);
  }
};
