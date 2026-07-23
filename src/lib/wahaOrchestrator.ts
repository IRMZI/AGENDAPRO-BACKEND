// Cliente HTTP do WahaOrchestrator. So o Backend usa - o Frontend nunca fala direto.
// Carrega config de env: WAHA_ORCHESTRATOR_URL, WAHA_ORCHESTRATOR_API_KEY.

const BASE = process.env.WAHA_ORCHESTRATOR_URL ?? "http://localhost:4010";
const KEY = process.env.WAHA_ORCHESTRATOR_API_KEY ?? "";

class OrchestratorError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OrchestratorError";
    this.statusCode = statusCode;
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(KEY ? { "x-api-key": KEY } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // ECONNREFUSED / ENOTFOUND / DNS errors -> fetch failed
    throw new OrchestratorError(
      `WAHA Orchestrator offline (${BASE}). Suba o serviço em WahaOrchestrator/`,
      503,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OrchestratorError(
      `WahaOrchestrator ${method} ${path} -> ${res.status} ${text}`,
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface OrchestratorSession {
  sessionId: string;
  workerId?: string;
  status?: string;
  state?: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  me?: { id?: string; pushName?: string } | null;
  [k: string]: unknown;
}

export interface OrchestratorQrResponse {
  // Orquestrador atual devolve { sessionId, qrCode, state }
  qrCode?: string;
  state?: string;
  status?: string;
  // Aceita tambem formatos alternativos (mimetype+data ou qr) p/ compat
  qr?: string;
  mimetype?: string;
  data?: string;
  [k: string]: unknown;
}

export interface WahaWebhookConfig {
  url: string;
  events: string[];
  customHeaders?: { name: string; value: string }[];
}

export const wahaOrchestrator = {
  createSession: (
    sessionId: string,
    companyId: string,
    config?: { webhooks?: WahaWebhookConfig[] },
  ) =>
    call<OrchestratorSession>("POST", "/sessions", {
      sessionId,
      companyId,
      tenantId: companyId,
      ...(config ? { config } : {}),
    }),

  getSession: (sessionId: string) =>
    call<OrchestratorSession>("GET", `/sessions/${sessionId}`),

  getStatus: (sessionId: string) =>
    call<OrchestratorSession>("GET", `/sessions/${sessionId}/status`),

  getQr: (sessionId: string) =>
    call<OrchestratorQrResponse>("GET", `/sessions/${sessionId}/qr`),

  logout: (sessionId: string) =>
    call<void>("POST", `/sessions/${sessionId}/logout`),

  restart: (sessionId: string) =>
    call<OrchestratorSession>("POST", `/sessions/${sessionId}/restart`),

  remove: (sessionId: string) =>
    call<void>("DELETE", `/sessions/${sessionId}`),

  sendText: (
    sessionId: string,
    chatId: string,
    text: string,
    replyTo?: string,
  ) =>
    call<unknown>("POST", `/sessions/${sessionId}/sendText`, {
      chatId,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),

  sendReaction: (
    sessionId: string,
    chatId: string,
    messageId: string,
    reaction: string,
  ) =>
    call<unknown>("POST", `/sessions/${sessionId}/sendReaction`, {
      chatId,
      messageId,
      reaction,
    }),

  editMessage: (
    sessionId: string,
    chatId: string,
    messageId: string,
    text: string,
  ) =>
    call<unknown>("POST", `/sessions/${sessionId}/editMessage`, {
      chatId,
      messageId,
      text,
    }),

  deleteMessage: (sessionId: string, chatId: string, messageId: string) =>
    call<unknown>("POST", `/sessions/${sessionId}/deleteMessage`, {
      chatId,
      messageId,
    }),

  sendSeen: (sessionId: string, chatId: string) =>
    call<unknown>("POST", `/sessions/${sessionId}/sendSeen`, { chatId }),

  startTyping: (sessionId: string, chatId: string) =>
    call<unknown>("POST", `/sessions/${sessionId}/startTyping`, { chatId }),

  stopTyping: (sessionId: string, chatId: string) =>
    call<unknown>("POST", `/sessions/${sessionId}/stopTyping`, { chatId }),

  getProfilePic: (sessionId: string, chatId: string) =>
    call<{ url: string | null }>(
      "POST",
      `/sessions/${sessionId}/getProfilePic`,
      { chatId },
    ),

  getChatPicture: (sessionId: string, chatId: string) =>
    call<{ url: string | null }>(
      "POST",
      `/sessions/${sessionId}/getChatPicture`,
      { chatId },
    ),

  // Metadados do grupo (inclui o nome/subject). GOWS retorna o nome em `Name`.
  getGroupMetadata: (sessionId: string, groupId: string) =>
    call<{ Name?: string; subject?: string; name?: string; [k: string]: unknown }>(
      "GET",
      `/sessions/${sessionId}/groups/${encodeURIComponent(groupId)}/metadata`,
    ),

  // Verifica se um número está no WhatsApp e resolve o chatId CANÔNICO (cuida do
  // 9º dígito BR). WAHA: GET /api/contacts/check-exists.
  checkNumber: (sessionId: string, phone: string) =>
    call<{ exists: boolean; chatId: string }>(
      "GET",
      `/sessions/${sessionId}/checkNumber/${encodeURIComponent(phone)}`,
    ),

  // Baixa a mídia de uma mensagem direto pela URL do worker (que o webhook
  // manda em `media.url`, apontando p/ localhost do worker). Retorna base64.
  proxyMedia: (sessionId: string, mediaUrl: string) =>
    call<{ data: string; mimetype: string; filename: string }>(
      "POST",
      `/sessions/${sessionId}/proxyMedia`,
      { mediaUrl },
    ),

  // Re-busca a mensagem no worker com downloadMedia=true e devolve o binário em
  // base64. Fallback quando não temos a `media.url` do webhook.
  downloadMedia: (sessionId: string, messageId: string, chatId?: string) =>
    call<{ data: string; mimetype: string; filename?: string }>(
      "POST",
      `/sessions/${sessionId}/downloadMedia`,
      { messageId, ...(chatId ? { chatId } : {}) },
    ),
};
