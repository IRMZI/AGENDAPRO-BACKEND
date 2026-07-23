// Validações do pipeline de mensagens WAHA, portadas 1:1 do WB (messaging-api).
// Ficam isoladas aqui para o handler (whatsappChatService) só orquestrar. Todas
// operam sobre o `payload` cru do webhook — não tocam no banco.

import { MessageStatus } from "@prisma/client";

// Canal/newsletter (@newsletter): não é conversa — descarta. Olha vários campos
// porque o jid do canal pode chegar em `from`/`to`/`Info.Chat`/`Info.Sender`/
// `key.remoteJid` conforme o tipo de evento. (WB: isNewsletterMessage)
export const isNewsletterMessage = (msg: unknown): boolean => {
  const m = msg as {
    from?: unknown;
    to?: unknown;
    _data?: { Info?: { Chat?: unknown; Sender?: unknown }; key?: { remoteJid?: unknown } };
  } | null;
  if (!m) return false;
  const candidates = [
    m.from,
    m.to,
    m._data?.Info?.Chat,
    m._data?.Info?.Sender,
    m._data?.key?.remoteJid,
  ];
  return candidates.some(
    (j) => typeof j === "string" && /@newsletter\b/i.test(j),
  );
};

// Payload de mensagem processável? Rejeita status/broadcast e lixo sem id.
// (WB: isValidWahaMessage — adaptado para não exigir `from` string, que pode
// faltar em alguns eventos fromMe do engine GOWS.)
export const isValidWahaMessage = (payload: unknown): boolean => {
  const p = payload as { id?: unknown; from?: unknown; to?: unknown } | null;
  if (!p || typeof p.id !== "string") return false;
  const from = (typeof p.from === "string" ? p.from : "").toLowerCase();
  const to = (typeof p.to === "string" ? p.to : "").toLowerCase();
  if (from.includes("@broadcast") || to.includes("@broadcast")) return false;
  return true;
};

// Grupo por MÚLTIPLOS sinais (não só o jid do chat): cobre o caso de mensagem de
// grupo enviada por mim (`fromMe`), onde `payload.to` é o MEU número e a decisão
// só pelo jid faria a mensagem vazar para uma conversa 1:1. (WB: isGroup)
export const computeIsGroup = (payload: unknown): boolean => {
  const p = payload as {
    from?: unknown;
    to?: unknown;
    isGroupMsg?: unknown;
    _data?: { Info?: { IsGroup?: unknown; Chat?: unknown } };
  } | null;
  if (!p) return false;
  const has = (v: unknown) => typeof v === "string" && v.includes("@g.us");
  return (
    p._data?.Info?.IsGroup === true ||
    p.isGroupMsg === true ||
    has(p.from) ||
    has(p.to) ||
    has(p._data?.Info?.Chat)
  );
};

// Timestamp robusto: WAHA/GOWS manda segundos (número), mas dependendo do
// caminho pode vir em ms, como string, ou como Long serializado {low,high}.
// Fallback = agora, com guarda de validade (rejeita datas absurdas). (WB:
// normalizeTimestamp)
export const normalizeTimestamp = (raw: unknown): Date => {
  const now = Date.now();
  let ms: number | null = null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    ms = raw > 1e12 ? raw : raw * 1000; // já em ms vs. em segundos
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw);
    ms = n > 1e12 ? n : n * 1000;
  } else if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as { low?: unknown }).low === "number"
  ) {
    const l = raw as { low: number; high?: number };
    const high = typeof l.high === "number" ? l.high : 0;
    const secs = high * 4294967296 + (l.low >>> 0);
    ms = secs * 1000;
  }

  // Guarda: antes de 2010 ou mais de 1 dia no futuro => usa agora.
  if (ms === null || ms < 1262304000000 || ms > now + 86400000) return new Date();
  return new Date(ms);
};

// ACK MONOTÔNICO: o status de uma mensagem só avança (pending→sent→delivered→
// read). Um ack atrasado com valor menor NUNCA regride um "read" para
// "delivered". `failed` é terminal para ack (não volta). (WB: COALESCE(ack,-1) <
// :ack)
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export const shouldAdvanceStatus = (
  current: MessageStatus,
  next: MessageStatus,
): boolean => {
  if (current === next) return false;
  if (current === MessageStatus.failed) return false;
  const c = STATUS_RANK[current] ?? -1;
  const n = STATUS_RANK[next] ?? -1;
  return n > c;
};
