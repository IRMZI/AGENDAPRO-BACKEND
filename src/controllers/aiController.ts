import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveCallerCompanyId } from "../middleware/auth.js";
import { runAiAgent, type ChatMessage } from "../services/aiAgentService.js";

// Throttle: at least 15s between AI calls per company (protects the Groq quota).
// 500ms grace absorbs client/network skew so the client's 15s timer never races
// into a 429. In-memory by design — resets on restart, which is fine for a soft
// rate limit.
const AI_COOLDOWN_MS = 15_000;
const AI_COOLDOWN_GRACE_MS = 500;
const lastCallByCompany = new Map<string, number>();

/**
 * POST /api/ai/chat
 * Body: { messages: { role: "user" | "assistant", content: string }[] }
 *
 * The company is derived from the authenticated token — never trusted from
 * the body — so every tool the agent runs is scoped to the caller's company.
 */
export const aiChatHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const companyId = await resolveCallerCompanyId(req);
    if (!companyId) {
      return res
        .status(403)
        .json({ error: "Nenhuma empresa associada a este usuário." });
    }

    // Per-company 15s cooldown.
    const now = Date.now();
    const elapsed = now - (lastCallByCompany.get(companyId) ?? 0);
    if (elapsed < AI_COOLDOWN_MS - AI_COOLDOWN_GRACE_MS) {
      const retryAfter = Math.ceil((AI_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        error: `Aguarde ${retryAfter}s antes de enviar outra mensagem.`,
        retryAfter,
      });
    }
    lastCallByCompany.set(companyId, now);

    const body = req.body as { messages?: unknown };
    if (!Array.isArray(body?.messages)) {
      return res.status(400).json({ error: "Campo 'messages' inválido." });
    }

    // Only user/assistant text turns reach the model; keep the last 20.
    const history: ChatMessage[] = body.messages
      .filter(
        (m: any) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0,
      )
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content }));

    if (history.length === 0) {
      return res.status(400).json({ error: "Nenhuma mensagem para processar." });
    }

    const { reply } = await runAiAgent({ companyId, messages: history });
    return res.status(200).json({ data: { reply } });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("[AI] chat error:", error?.message || error);
    return res
      .status(500)
      .json({ error: error?.message || "Erro ao processar a solicitação de IA." });
  }
};
