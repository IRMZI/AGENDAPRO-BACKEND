import { randomUUID } from "node:crypto";
import {
  ConversationType,
  MessageDirection,
  MessageStatus,
  WhatsappSessionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { wahaOrchestrator } from "../lib/wahaOrchestrator.js";
import { emitToCompany } from "../lib/realtime.js";
import { normalizeDigits, formatBrazilianNumber } from "../lib/phone.js";
import { mapWahaStatus } from "./whatsappService.js";
import {
  computeIsGroup,
  isNewsletterMessage,
  isValidWahaMessage,
  normalizeTimestamp,
  shouldAdvanceStatus,
} from "./whatsapp/wahaValidation.js";
import { ingestMedia } from "./whatsapp/mediaIngest.js";

// ============================================================
// Helpers de JID/parsing WAHA
// ============================================================

const isGroupJid = (jid: string) => jid.endsWith("@g.us");
const phoneFromJid = (jid: string) => jid.split("@")[0]?.split(":")[0] ?? "";

// Telefone REAL por trás de um @lid: o GOWS manda o número verdadeiro em
// `_data.Info.SenderAlt`/`RecipientAlt` como jid `@s.whatsapp.net`/`@c.us`
// (ex.: "555197917532:52@s.whatsapp.net"). LID NÃO é telefone — só extraímos
// quando o alt-jid é um número de telefone de verdade.
const realPhoneFromAltJid = (jid: string | null | undefined): string | null => {
  if (!jid || !/@(s\.whatsapp\.net|c\.us)/i.test(jid)) return null;
  const digits = (jid.split("@")[0]?.split(":")[0] ?? "").replace(/\D/g, "");
  return digits || null;
};

// Monta o jid @c.us de um telefone, garantindo o DDI 55 quando parece número
// nacional (DDD + número, 10 ou 11 díg). Sem o 55, o WhatsApp não resolve o LID
// ("no LID found for 51980276600@s.whatsapp.net").
const toContactJid = (phone: string): string => {
  let d = (phone || "").replace(/\D/g, "");
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return `${d}@c.us`;
};

// Identifica a conversa: para inbound usamos `from`, para outbound `to`.
const resolveChatId = (payload: any): string => {
  // GOWS: `_data.Info.Chat` é o jid REAL do chat (o grupo p/ grupos, o contato
  // p/ 1:1). É a fonte mais confiável — em mensagem de GRUPO enviada por mim
  // (`fromMe`), `payload.to` é o MEU próprio número (não o grupo), o que fazia
  // a mensagem vazar para uma conversa 1:1.
  const infoChat = payload?._data?.Info?.Chat;
  if (typeof infoChat === "string" && infoChat) return infoChat;
  if (typeof payload?.chatId === "string") return payload.chatId;
  if (payload?.fromMe && typeof payload?.to === "string") return payload.to;
  if (typeof payload?.from === "string") return payload.from;
  return "";
};

// Mapeia WAHA ack -> nosso MessageStatus
const ACK_TO_STATUS: Record<number, MessageStatus> = {
  0: MessageStatus.pending,
  1: MessageStatus.sent,
  2: MessageStatus.delivered,
  3: MessageStatus.read,
  4: MessageStatus.read,
};

// ============================================================
// Validar webhook (companyId via wahaSessionId)
// ============================================================

export const resolveSessionByWahaId = async (wahaSessionId: string) => {
  // waha_session_id é único globalmente (constraint no schema): findUnique não
  // ambígua a empresa como findFirst poderia.
  return prisma.whatsappSession.findUnique({
    where: { waha_session_id: wahaSessionId },
  });
};

// Sessão AUTENTICADA e ativa da empresa (a que consegue enviar de fato). Usada
// como fallback quando a sessão dona da conversa morreu (reconexão gera sessão
// nova, mas a conversa antiga ainda aponta para a antiga).
const getActiveSession = (companyId: string) =>
  prisma.whatsappSession.findFirst({
    where: { company_id: companyId, is_active: true, status: "authenticated" },
    orderBy: { last_seen_at: "desc" },
  });

// Resolve a sessão pela qual ENVIAR: a própria da conversa se estiver viva;
// senão a sessão ativa da empresa. Corrige "não consigo responder depois de
// reconectar" sem trocar o número em setups multi-conexão (usa a da conversa
// sempre que ela está autenticada).
const resolveSendSession = async <
  T extends { session?: { status: WhatsappSessionStatus; is_active: boolean; waha_session_id: string; id: string } | null },
>(
  conv: T,
  companyId: string,
): Promise<{ id: string; waha_session_id: string }> => {
  const own = conv.session;
  if (own && own.is_active && own.status === WhatsappSessionStatus.authenticated) {
    return own;
  }
  const active = await getActiveSession(companyId);
  return active ?? own!;
};

// ============================================================
// Upserts (contact + conversation + message)
// ============================================================

const upsertContact = async (params: {
  companyId: string;
  sessionId: string;
  waId: string;
  pushName?: string | null;
  // Telefone REAL (resolvido do SenderAlt). Quando o wa_id é um @lid, o número
  // por trás dele só vem por aqui — phoneFromJid daria o LID, não o telefone.
  realPhone?: string | null;
}) => {
  // Pra @lid, NÃO usa phoneFromJid (seria o LID): só grava telefone quando
  // temos o número real. Pra @c.us, o próprio jid já é o telefone — canoniza
  // (DDI 55 + 9º dígito) para bater sempre com a mesma chave de identidade.
  const isLid = params.waId.endsWith("@lid");
  const phone =
    params.realPhone ||
    (isLid ? null : formatBrazilianNumber(phoneFromJid(params.waId)) || null);
  const existing = await prisma.whatsappContact.findUnique({
    where: {
      session_id_wa_id: { session_id: params.sessionId, wa_id: params.waId },
    },
  });
  if (existing) {
    const data: { push_name?: string; phone?: string; updated_at?: Date } = {};
    if (params.pushName && params.pushName !== existing.push_name) {
      data.push_name = params.pushName;
    }
    // Atualiza o telefone quando aprendemos o número real (ex.: contato que
    // estava com o LID como "telefone").
    if (params.realPhone && params.realPhone !== existing.phone) {
      data.phone = params.realPhone;
    }
    if (Object.keys(data).length === 0) return existing;
    return prisma.whatsappContact.update({
      where: { id: existing.id },
      data: { ...data, updated_at: new Date() },
    });
  }
  const contact = await prisma.whatsappContact.create({
    data: {
      id: randomUUID(),
      company_id: params.companyId,
      session_id: params.sessionId,
      wa_id: params.waId,
      push_name: params.pushName ?? null,
      phone,
    },
  });
  // Lazy: tenta pegar profile pic em background, sem bloquear o evento
  void syncContactProfilePic(contact.id, params.sessionId, params.waId).catch(
    (err) =>
      console.warn("[whatsappChat] profile pic sync falhou:", err?.message),
  );
  return contact;
};

const syncContactProfilePic = async (
  contactId: string,
  sessionId: string,
  waId: string,
) => {
  const session = await prisma.whatsappSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return;
  try {
    const res = await wahaOrchestrator.getProfilePic(
      session.waha_session_id,
      waId,
    );
    if (res?.url) {
      await prisma.whatsappContact.update({
        where: { id: contactId },
        data: { profile_pic_url: res.url, updated_at: new Date() },
      });
    }
  } catch {
    // 404 ou sem foto — ok
  }
};

// Busca nome (subject) + foto do grupo no WAHA e popula WhatsappGroup,
// vinculando à conversa — para grupo parar de aparecer como número.
const pickGroupName = (m: any): string | null => {
  for (const k of ["Name", "subject", "name"]) {
    const v = m?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

const syncGroupInfo = async (
  session: { id: string; company_id: string; waha_session_id: string },
  conversation: { id: string; wa_chat_id: string },
) => {
  let name: string | null = null;
  let pic: string | null = null;
  try {
    const meta = await wahaOrchestrator.getGroupMetadata(
      session.waha_session_id,
      conversation.wa_chat_id,
    );
    name = pickGroupName(meta);
  } catch {
    /* sem metadata — segue */
  }
  try {
    const p = await wahaOrchestrator.getChatPicture(
      session.waha_session_id,
      conversation.wa_chat_id,
    );
    pic = p?.url ?? null;
  } catch {
    /* sem foto — segue */
  }
  if (!name && !pic) return;
  const group = await prisma.whatsappGroup.upsert({
    where: {
      session_id_wa_id: {
        session_id: session.id,
        wa_id: conversation.wa_chat_id,
      },
    },
    create: {
      id: randomUUID(),
      company_id: session.company_id,
      session_id: session.id,
      wa_id: conversation.wa_chat_id,
      name,
      profile_pic_url: pic,
    },
    update: {
      ...(name ? { name } : {}),
      ...(pic ? { profile_pic_url: pic } : {}),
      updated_at: new Date(),
    },
  });
  await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { group_id: group.id },
  });
  emitToCompany(session.company_id, "conversation:updated", {
    conversation: { id: conversation.id },
  });
};

// Baixa a mídia recebida e guarda no storage durável, depois atualiza a
// mensagem com a URL definitiva e emite message:updated. Fire-and-forget: roda
// fora do caminho do webhook (não bloqueia o ACK 200).
const ingestMediaAndUpdate = async (
  session: { id: string; company_id: string; waha_session_id: string },
  message: { id: string; conversation_id: string; wa_message_id: string },
  payload: WahaMessagePayload,
) => {
  const ing = await ingestMedia({
    companyId: session.company_id,
    wahaSessionId: session.waha_session_id,
    mediaUrl: payload.media?.url ?? null,
    messageId: message.wa_message_id,
    chatId: resolveChatId(payload),
  });
  if (!ing) return;
  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: {
      media_url: ing.url,
      ...(ing.mimeType ? { media_mime_type: ing.mimeType } : {}),
      updated_at: new Date(),
    },
  });
  emitToCompany(session.company_id, "message:updated", {
    conversationId: message.conversation_id,
    message: updated,
  });
};

const upsertConversation = async (params: {
  companyId: string;
  sessionId: string;
  chatId: string;
  contactId?: string;
}) => {
  const type = isGroupJid(params.chatId)
    ? ConversationType.group
    : ConversationType.individual;
  const existing = await prisma.whatsappConversation.findUnique({
    where: {
      session_id_wa_chat_id: {
        session_id: params.sessionId,
        wa_chat_id: params.chatId,
      },
    },
  });
  if (existing) return { conversation: existing, created: false };
  const conversation = await prisma.whatsappConversation.create({
    data: {
      id: randomUUID(),
      company_id: params.companyId,
      session_id: params.sessionId,
      type,
      wa_chat_id: params.chatId,
      contact_id: params.contactId ?? null,
    },
  });
  return { conversation, created: true };
};

// Resolve a conversa de GRUPO reusando company-wide. O jid @g.us é estável entre
// sessões — sem isso, reconectar (nova sessão) recriava a conversa do grupo,
// duplicando a thread. Reusa a existente em qualquer sessão da empresa; só cria
// quando o grupo é realmente novo.
const resolveGroupConversation = async (params: {
  companyId: string;
  sessionId: string;
  chatId: string;
}): Promise<{ conversation: any; created: boolean }> => {
  const existing = await prisma.whatsappConversation.findFirst({
    where: {
      company_id: params.companyId,
      type: ConversationType.group,
      wa_chat_id: params.chatId,
    },
    orderBy: [{ last_message_at: { sort: "desc", nulls: "last" } }],
  });
  if (existing) return { conversation: existing, created: false };
  return upsertConversation(params);
};

// ============================================================
// Envio automático (saudação / futuras automações) — direto, sem fila
// ============================================================

const renderTpl = (
  body: string,
  vars: Record<string, string | null | undefined>,
) => body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (vars[k] ?? "").toString());

interface ConvLite {
  id: string;
  company_id: string;
  session_id: string;
  wa_chat_id: string;
}

// Grava a mensagem enviada no inbox (aparece como enviada pela empresa) e
// emite socket para a UI atualizar em tempo real. NÃO faz o envio em si —
// chame só DEPOIS que o wahaOrchestrator.sendText tiver sucesso, para nunca
// deixar uma conversa-fantasma se o envio falhar.
const persistOutboundMessage = async (
  conversation: ConvLite,
  body: string,
  tag: string,
) => {
  const now = new Date();
  const message = await prisma.whatsappMessage.create({
    data: {
      id: randomUUID(),
      company_id: conversation.company_id,
      session_id: conversation.session_id,
      conversation_id: conversation.id,
      wa_message_id: `local-${randomUUID()}`,
      direction: MessageDirection.outbound,
      status: MessageStatus.pending,
      to_number: phoneFromJid(conversation.wa_chat_id),
      body,
      timestamp: now,
      raw_data: { _automated: tag },
    },
  });
  const updatedConv = await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { last_message: body.slice(0, 200), last_message_at: now, updated_at: now },
  });
  emitToCompany(conversation.company_id, "message:new", {
    conversationId: conversation.id,
    message,
  });
  emitToCompany(conversation.company_id, "conversation:updated", {
    conversation: updatedConv,
  });
};

// Envia uma mensagem automática para uma conversa que JÁ existe (ex.: saudação
// no primeiro contato) e a registra no inbox.
const sendAutomatedReply = async (
  session: { waha_session_id: string },
  conversation: ConvLite,
  body: string,
  tag: string,
) => {
  await wahaOrchestrator.sendText(
    session.waha_session_id,
    conversation.wa_chat_id,
    body,
  );
  await persistOutboundMessage(conversation, body, tag);
};

// Envia uma mensagem automática para um TELEFONE (não precisa de conversa
// pré-existente). Resolve a sessão ativa da empresa, garante contato+conversa
// e grava no inbox. Usado pelas automações de agendamento. Direto (sem fila).
export const sendAutomatedMessageToPhone = async (
  companyId: string,
  phone: string,
  body: string,
  tag: string,
): Promise<{ sent: boolean; reason?: string }> => {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return { sent: false, reason: "no_phone" };
  if (!body || !body.trim()) return { sent: false, reason: "empty_body" };
  const session = await prisma.whatsappSession.findFirst({
    where: { company_id: companyId, is_active: true, status: "authenticated" },
    orderBy: { last_seen_at: "desc" },
  });
  if (!session) return { sent: false, reason: "no_active_session" };

  // Reusa a conversa existente do contato e envia para o wa_chat_id REAL dela
  // (que pode ser @lid — o mesmo destino das respostas manuais, que entregam).
  // Construir `${digits}@c.us` na unha cria thread duplicada e falha quando o
  // contato é um LID. Só cai no @c.us quando é um número realmente novo.
  const last10 = normalizeDigits(digits);
  let conversation: ConvLite | null =
    (await prisma.whatsappConversation.findFirst({
      where: {
        company_id: companyId,
        session_id: session.id,
        type: ConversationType.individual,
        wa_chat_id: { startsWith: `${digits}@` },
      },
      orderBy: [{ last_message_at: { sort: "desc", nulls: "last" } }],
    })) as ConvLite | null;

  // Fallback: telefone armazenado difere dos dígitos do JID — casa pelos
  // últimos 10 dígitos (DDD+número) do wa_chat_id ou do contato.
  if (!conversation && last10) {
    const candidates = await prisma.whatsappConversation.findMany({
      where: {
        company_id: companyId,
        session_id: session.id,
        type: ConversationType.individual,
      },
      include: { contact: { select: { phone: true } } },
      orderBy: [{ last_message_at: { sort: "desc", nulls: "last" } }],
    });
    conversation =
      (candidates.find(
        (c) =>
          normalizeDigits(c.wa_chat_id.split("@")[0]) === last10 ||
          normalizeDigits(c.contact?.phone) === last10,
      ) as ConvLite | undefined) ?? null;
  }

  // Envia ANTES de persistir/criar conversa: se o envio falhar, nada de
  // conversa-fantasma vazia no inbox.
  const targetChatId = conversation?.wa_chat_id ?? toContactJid(digits);
  await wahaOrchestrator.sendText(session.waha_session_id, targetChatId, body);

  // Número novo (sem conversa): só agora cria contato + conversa.
  if (!conversation) {
    const contact = await upsertContact({
      companyId,
      sessionId: session.id,
      waId: targetChatId,
      pushName: null,
    });
    const created = await upsertConversation({
      companyId,
      sessionId: session.id,
      chatId: targetChatId,
      contactId: contact.id,
    });
    conversation = created.conversation;
  }

  await persistOutboundMessage(conversation, body, tag);
  return { sent: true };
};

// Saudação automática no primeiro contato, se a empresa tiver uma ativa.
const maybeSendGreeting = async (
  session: { waha_session_id: string; company_id: string },
  conversation: ConvLite,
  contactName: string | null,
) => {
  const greeting = await prisma.messageTemplate.findFirst({
    where: {
      company_id: session.company_id,
      category: "greeting",
      is_active: true,
    },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
  });
  if (!greeting) return;
  const company = await prisma.company.findUnique({
    where: { id: session.company_id },
    select: { name: true, company_nickname: true },
  });
  const body = renderTpl(greeting.body, {
    cliente: (contactName ?? "").split(" ")[0] || "",
    telefone: phoneFromJid(conversation.wa_chat_id),
    empresa: company?.company_nickname || company?.name || "",
  });
  if (!body.trim()) return;
  await sendAutomatedReply(session, conversation, body, "greeting");
};

// ============================================================
// Event handlers
// ============================================================

interface WahaMessagePayload {
  id?: string;
  timestamp?: number;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  type?: string;
  ack?: number;
  ackName?: string;
  // "api" quando a msg saiu pelo nosso sistema (usado no dedup fromMe do WB).
  source?: string;
  isGroupMsg?: boolean;
  // Ids da mensagem-alvo em eventos de edição/exclusão.
  editedMessageId?: string;
  revokedMessageId?: string;
  _data?: {
    notifyName?: string;
    quotedMessage?: any;
    key?: { remoteJid?: string };
    Message?: any;
    // Engine GOWS coloca o nome do contato aqui (não em notifyName) e o
    // telefone REAL por trás do @lid em SenderAlt/RecipientAlt.
    Info?: {
      PushName?: string;
      Sender?: string;
      SenderAlt?: string;
      RecipientAlt?: string;
      IsGroup?: boolean;
      Chat?: string;
    };
  };
  notifyName?: string;
  media?: {
    url?: string | null;
    mimetype?: string | null;
    filename?: string | null;
  } | null;
  reply_to?: any;
  replyTo?: any;
  quotedMsg?: any;
  reaction?: {
    text?: string;
    messageId?: string;
  };
}

const extractReplyMeta = (payload: WahaMessagePayload) => {
  const candidates = [
    payload.reply_to,
    payload.replyTo,
    payload.quotedMsg,
    payload._data?.quotedMessage,
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  const q = candidates[0];
  const id = q.id?._serialized || q.id || q.messageId;
  if (!id) return null;
  return {
    messageId: typeof id === "string" ? id : String(id),
    body: q.body ?? q.text ?? null,
    from: q.from ?? null,
  };
};

// Resolve a conversa INDIVIDUAL pela IDENTIDADE da pessoa (telefone canônico),
// não só pelo jid. Mesma pessoa pode chegar como @lid, @c.us ou via WhatsApp
// Web/celular com jids diferentes — aqui reusamos a conversa existente em vez
// de duplicar. Aprende nome/telefone real no contato.
const resolveIndividualConversation = async (params: {
  companyId: string;
  sessionId: string;
  chatId: string;
  pushName: string | null;
  realPhone: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<{ conversation: any; created: boolean }> => {
  const { companyId, sessionId, chatId, pushName, realPhone } = params;
  const phoneKey =
    normalizeDigits(realPhone) || normalizeDigits(phoneFromJid(chatId));

  // 1. Match exato pelo jid.
  let conv = await prisma.whatsappConversation.findUnique({
    where: { session_id_wa_chat_id: { session_id: sessionId, wa_chat_id: chatId } },
    include: { contact: { select: { id: true, phone: true, push_name: true } } },
  });

  // 2. Match pela identidade (telefone canônico) — unifica LID/@c.us/web.
  // Busca em TODA a empresa (não só na sessão do webhook): reconexão cria nova
  // sessão, mas a pessoa continua a mesma; reusa a conversa existente.
  if (!conv && phoneKey) {
    const candidates = await prisma.whatsappConversation.findMany({
      where: {
        company_id: companyId,
        type: ConversationType.individual,
      },
      include: { contact: { select: { id: true, phone: true, push_name: true } } },
      orderBy: [{ last_message_at: "desc" }],
      take: 500,
    });
    conv =
      candidates.find(
        (c) =>
          normalizeDigits(c.contact?.phone) === phoneKey ||
          normalizeDigits(c.wa_chat_id.split("@")[0]) === phoneKey,
      ) ?? null;
  }

  if (conv) {
    // Aprende nome/telefone real no contato vinculado.
    let contactId = conv.contact_id;
    if (!contactId) {
      // Cria o contato na sessão DA CONVERSA (não na do webhook): a conversa
      // reusada pode ser de outra sessão, e o contato é chaveado por
      // (session_id, wa_id) — mantê-los juntos evita fragmentar.
      const contact = await upsertContact({
        companyId,
        sessionId: conv.session_id,
        waId: conv.wa_chat_id,
        pushName,
        realPhone,
      });
      contactId = contact.id;
      await prisma.whatsappConversation.update({
        where: { id: conv.id },
        data: { contact_id: contactId },
      });
    } else {
      const patch: Record<string, unknown> = {};
      if (pushName && pushName !== conv.contact?.push_name)
        patch.push_name = pushName;
      if (realPhone && realPhone !== conv.contact?.phone)
        patch.phone = realPhone;
      if (Object.keys(patch).length) {
        await prisma.whatsappContact.update({
          where: { id: contactId },
          data: { ...patch, updated_at: new Date() },
        });
      }
    }
    return { conversation: conv, created: false };
  }

  // 3. Novo contato + conversa.
  const contact = await upsertContact({
    companyId,
    sessionId,
    waId: chatId,
    pushName,
    realPhone,
  });
  return upsertConversation({ companyId, sessionId, chatId, contactId: contact.id });
};

const handleIncomingMessage = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) {
    console.warn(`[whatsappChat] webhook para session desconhecida: ${wahaSessionId}`);
    return;
  }
  // Validações do WB: payload processável (id + não-broadcast) e não-newsletter.
  // O `!payload.id` é redundante com isValidWahaMessage, mas estreita o tipo p/ TS.
  if (!isValidWahaMessage(payload) || !payload.id) return;
  if (isNewsletterMessage(payload)) return;

  const chatId = resolveChatId(payload);
  if (!chatId) return;
  // Redundante com as validações acima, mas cobre o jid JÁ resolvido
  // (status/stories/broadcast/canais que escaparem pelo Info.Chat).
  if (chatId.endsWith("@broadcast") || chatId.endsWith("@newsletter")) return;

  // Grupo por MÚLTIPLOS sinais (não só o jid): previne msg de grupo — em especial
  // as `fromMe`, onde `payload.to` é o MEU número — vazar para uma conversa 1:1.
  const isGroup = computeIsGroup(payload);
  // Grupo sinalizado mas sem jid de grupo resolvível (Info.Chat ausente): não dá
  // pra endereçar a conversa certa — descarta em vez de vazar no 1:1.
  if (isGroup && !isGroupJid(chatId)) return;

  const direction = payload.fromMe
    ? MessageDirection.outbound
    : MessageDirection.inbound;
  const status =
    typeof payload.ack === "number"
      ? (ACK_TO_STATUS[payload.ack] ?? MessageStatus.sent)
      : direction === MessageDirection.outbound
        ? MessageStatus.sent
        : MessageStatus.delivered;

  // notifyName/PushName é SEMPRE o nome de QUEM ENVIOU a mensagem. Numa mensagem
  // MINHA (fromMe) esse nome é o do dono da conta (ex.: "Romariz"), NÃO o do
  // contato — usá-lo gravava o contato com o meu nome. Só aproveitamos o pushName
  // quando a mensagem foi RECEBIDA (inbound), aí sim é o nome do contato.
  const pushName = payload.fromMe
    ? null
    : (payload.notifyName ??
      payload._data?.notifyName ??
      payload._data?.Info?.PushName ??
      null);
  // Telefone real por trás do @lid: SenderAlt (inbound) / RecipientAlt (out).
  // Canoniza (par do normalizeDigits) p/ o contato guardar sempre a mesma forma.
  const realPhoneRaw = payload.fromMe
    ? realPhoneFromAltJid(payload._data?.Info?.RecipientAlt)
    : realPhoneFromAltJid(payload._data?.Info?.SenderAlt);
  const realPhone = realPhoneRaw ? formatBrazilianNumber(realPhoneRaw) : null;

  // Grupo: chaveado pelo jid @g.us (estável). Individual: unifica pela
  // identidade (telefone) p/ não duplicar conversa entre LID/@c.us/web.
  const { conversation, created: conversationCreated } = isGroup
    ? await resolveGroupConversation({
        companyId: session.company_id,
        sessionId: session.id,
        chatId,
      })
    : await resolveIndividualConversation({
        companyId: session.company_id,
        sessionId: session.id,
        chatId,
        pushName,
        realPhone,
      });

  const ts = normalizeTimestamp(payload.timestamp);

  // Idempotência via @@unique([session_id, wa_message_id]). O fallback pela
  // CONVERSA cobre reconexão: a mesma mensagem reentregue sob uma sessão NOVA
  // (session_id diferente) tem a conversa unificada por identidade, então sem
  // ele entraria duplicada. Só roda quando a conversa é de OUTRA sessão (o caso
  // de reconexão) — no caminho normal (mesma sessão) o findUnique já resolve,
  // evitando o custo por-conversa em toda mensagem. Bump de status só se AVANÇAR
  // (ACK monotônico do WB).
  const exists =
    (await prisma.whatsappMessage.findUnique({
      where: {
        session_id_wa_message_id: {
          session_id: session.id,
          wa_message_id: payload.id,
        },
      },
    })) ??
    (conversation.session_id !== session.id
      ? await prisma.whatsappMessage.findFirst({
          where: { conversation_id: conversation.id, wa_message_id: payload.id },
        })
      : null);
  if (exists) {
    if (shouldAdvanceStatus(exists.status, status)) {
      const bumped = await prisma.whatsappMessage.update({
        where: { id: exists.id },
        data: { status, updated_at: new Date() },
      });
      emitToCompany(session.company_id, "message:updated", {
        conversationId: bumped.conversation_id,
        message: bumped,
      });
    }
    return;
  }

  // Reconciliacao: se for outbound e tivermos uma row "local-..." recente
  // da mesma conv com o mesmo body, atualiza ela em vez de criar nova.
  // - Sem filtro por session_id: a mensagem pode ter sido enviada pela sessão
  //   ATIVA (fallback) e não pela sessão dona da conversa; o conversation_id já
  //   identifica a thread com precisão.
  // - FIFO (created_at asc): ao enviar o mesmo texto 2x, o 1º eco casa com o 1º
  //   placeholder. Com LIFO, o placeholder mais antigo virava um "local-" órfão.
  if (direction === MessageDirection.outbound) {
    const since = new Date(Date.now() - 5 * 60 * 1000); // 5min
    const placeholder = await prisma.whatsappMessage.findFirst({
      where: {
        conversation_id: conversation.id,
        direction: MessageDirection.outbound,
        wa_message_id: { startsWith: "local-" },
        body: payload.body ?? null,
        created_at: { gte: since },
      },
      orderBy: { created_at: "asc" },
    });
    if (placeholder) {
      await prisma.whatsappMessage.update({
        where: { id: placeholder.id },
        data: {
          wa_message_id: payload.id,
          status,
          timestamp: ts,
          raw_data: payload as any,
          updated_at: new Date(),
        },
      });
      return;
    }
  }

  const replyMeta = extractReplyMeta(payload);
  const rawWithMeta: any = { ...payload };
  if (replyMeta) rawWithMeta._replyTo = replyMeta;

  // Em GRUPO, cada mensagem recebida tem um remetente diferente (participante).
  // Guarda nome+telefone do remetente para o front mostrar QUEM falou.
  let groupSenderPhone: string | null = null;
  if (isGroup && direction === MessageDirection.inbound) {
    const senderName =
      payload._data?.Info?.PushName ?? payload.notifyName ?? null;
    groupSenderPhone =
      realPhoneFromAltJid(payload._data?.Info?.SenderAlt) ??
      (payload._data?.Info?.Sender
        ? phoneFromJid(payload._data.Info.Sender)
        : null);
    if (senderName || groupSenderPhone) {
      rawWithMeta._groupSender = { name: senderName, phone: groupSenderPhone };
    }
  }

  // from_number: em grupo, `payload.from` é o JID DO GRUPO — não o remetente.
  // Usa o telefone real do participante que falou (quando conhecido).
  const fromNumber =
    groupSenderPhone ?? (payload.from ? phoneFromJid(payload.from) : null);

  const created = await prisma.whatsappMessage.create({
    data: {
      id: randomUUID(),
      company_id: session.company_id,
      session_id: session.id,
      conversation_id: conversation.id,
      wa_message_id: payload.id,
      direction,
      status,
      from_number: fromNumber,
      to_number: payload.to ? phoneFromJid(payload.to) : null,
      body: payload.body ?? null,
      media_type: payload.type && payload.type !== "chat" ? payload.type : null,
      media_url: payload.media?.url ?? null,
      media_mime_type: payload.media?.mimetype ?? null,
      timestamp: ts,
      raw_data: rawWithMeta,
    },
  });

  const updatedConv = await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: {
      last_message: payload.body?.slice(0, 200) ?? "[mídia]",
      last_message_at: ts,
      // Recebida: +1 não-lida. Enviada (resposta): ZERA as não-lidas — quem
      // responde já leu a conversa (paridade com o reset do WB no fromMe).
      unread_count:
        direction === MessageDirection.inbound ? { increment: 1 } : 0,
      updated_at: new Date(),
    },
  });

  emitToCompany(session.company_id, "message:new", {
    conversationId: conversation.id,
    message: created,
  });
  emitToCompany(session.company_id, "conversation:updated", {
    conversation: updatedConv,
  });

  // Mídia: a URL do webhook aponta p/ o worker e EXPIRA. Baixa e guarda no
  // storage durável em background (não bloqueia o webhook); ao concluir,
  // atualiza a média_url e emite message:updated p/ a UI trocar a URL.
  if (payload.media?.url || payload.hasMedia) {
    void ingestMediaAndUpdate(session, created, payload).catch((err) =>
      console.warn("[whatsappChat] media ingest falhou:", err?.message),
    );
  }

  // Saudação automática: só no PRIMEIRO contato (conversa recém-criada),
  // em mensagem recebida (não fromMe) e chat individual. Idempotente por
  // conversa (só dispara quando a conversa é criada).
  if (
    conversationCreated &&
    direction === MessageDirection.inbound &&
    !isGroup
  ) {
    const greetName =
      payload.notifyName ??
      payload._data?.notifyName ??
      payload._data?.Info?.PushName ??
      null;
    void maybeSendGreeting(session, conversation, greetName).catch((err) =>
      console.warn("[whatsappChat] greeting falhou:", err?.message),
    );
  }

  // Nome do grupo: busca o subject no WAHA quando a conversa de grupo ainda não
  // tem o grupo vinculado (cobre grupos novos e antigos no próximo evento).
  if (isGroup && !conversation.group_id) {
    void syncGroupInfo(session, conversation).catch((err) =>
      console.warn("[whatsappChat] syncGroupInfo falhou:", err?.message),
    );
  }
};

// ============================================================
// Reaction handler (evento message.reaction)
// ============================================================

const handleReactionEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const targetId = payload.reaction?.messageId ?? payload.id;
  const emoji = payload.reaction?.text ?? "";
  if (!targetId) return;

  const target = await prisma.whatsappMessage.findFirst({
    where: { session_id: session.id, wa_message_id: targetId },
  });
  if (!target) return;

  const raw = (target.raw_data as any) ?? {};
  const reactions: any[] = Array.isArray(raw._reactions) ? raw._reactions : [];
  const reactorWaId = payload.fromMe ? payload.to : payload.from;
  // Chave de identidade do reagente: se for jid de telefone, normaliza (tolera o
  // 9º dígito e o DDI); se for @lid ou vazio, cai no jid cru. Sem isso, a mesma
  // pessoa chegando com jids diferentes acumulava reações duplicadas.
  const reactorKey = (jid: string | null | undefined): string => {
    if (!jid) return "";
    const norm = normalizeDigits(phoneFromJid(jid));
    return norm || jid;
  };
  const key = reactorKey(reactorWaId);
  const idx = reactions.findIndex((r) => reactorKey(r.from) === key);
  if (emoji) {
    const entry = {
      from: reactorWaId,
      emoji,
      timestamp: payload.timestamp ?? Date.now() / 1000,
    };
    if (idx >= 0) reactions[idx] = entry;
    else reactions.push(entry);
  } else if (idx >= 0) {
    // emoji vazio -> removeu reacao
    reactions.splice(idx, 1);
  }

  const updated = await prisma.whatsappMessage.update({
    where: { id: target.id },
    data: {
      raw_data: { ...raw, _reactions: reactions },
      updated_at: new Date(),
    },
  });

  emitToCompany(session.company_id, "message:updated", {
    conversationId: target.conversation_id,
    message: updated,
  });
};

const handleAckEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session || !payload.id || typeof payload.ack !== "number") return;
  // ACK de newsletter/canal não corresponde a mensagem nossa (WB descarta antes
  // de qualquer query).
  if (isNewsletterMessage(payload)) return;
  const status = ACK_TO_STATUS[payload.ack] ?? MessageStatus.sent;
  // Match EXATO escopado à sessão (indexado). Um ack de mensagem de sessão
  // antiga (pré-reconexão) simplesmente não avança o status — aceitável e evita
  // seq scan de tabela inteira no caminho quente do ack.
  const before = await findMessageByWaId(session, payload.id);
  if (!before) return;
  // ACK monotônico: nunca regride read->delivered com um ack atrasado.
  if (!shouldAdvanceStatus(before.status, status)) return;
  const updated = await prisma.whatsappMessage.update({
    where: { id: before.id },
    data: { status, updated_at: new Date() },
  });
  emitToCompany(session.company_id, "message:updated", {
    conversationId: updated.conversation_id,
    message: updated,
  });
};

// ============================================================
// Typing indicator (presence.update)
// ============================================================

const handlePresenceEvent = async (
  wahaSessionId: string,
  payload: any,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const chatId = payload?.id ?? payload?.from ?? payload?.chatId;
  if (!chatId) return;
  const conv = await prisma.whatsappConversation.findUnique({
    where: {
      session_id_wa_chat_id: {
        session_id: session.id,
        wa_chat_id: chatId,
      },
    },
  });
  if (!conv) return;
  const presences: any[] = Array.isArray(payload?.presences)
    ? payload.presences
    : [{ presence: payload?.presence }];
  const typing = presences.some(
    (p) => p?.presence === "composing" || p?.presence === "typing",
  );
  emitToCompany(session.company_id, "typing", {
    conversationId: conv.id,
    typing,
  });
};

// ============================================================
// Session status (evento session.status) — status ao vivo
// ============================================================

const handleSessionStatusEvent = async (
  wahaSessionId: string,
  payload: any,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) {
    console.warn(
      `[whatsappChat] session.status para session desconhecida: ${wahaSessionId}`,
    );
    return;
  }
  // WAHA manda { name, status } (ex.: WORKING, SCAN_QR_CODE, STOPPED, FAILED).
  const mapped = mapWahaStatus(payload?.status ?? payload?.state);
  if (!mapped) return;

  const updates: Record<string, unknown> = {
    status: mapped,
    last_seen_at: new Date(),
    updated_at: new Date(),
  };
  // Estado terminal -> some da UI (mesma regra do whatsappService).
  if (
    mapped === WhatsappSessionStatus.failed ||
    mapped === WhatsappSessionStatus.disconnected
  ) {
    updates.is_active = false;
  }
  // Se o WAHA mandou o numero pareado junto, aproveita.
  const meId: string | undefined = payload?.me?.id ?? payload?.payload?.me?.id;
  if (meId && !session.phone_number) {
    updates.phone_number = meId.split("@")[0] ?? null;
  }

  const updated = await prisma.whatsappSession.update({
    where: { id: session.id },
    data: updates,
  });

  emitToCompany(session.company_id, "session:status", {
    sessionId: updated.id,
    wahaSessionId,
    status: updated.status,
    phoneNumber: updated.phone_number,
  });
};

// ============================================================
// Edição / exclusão / LID / sessão deletada (paridade WB)
// ============================================================

// Match EXATO da mensagem pelo wa_message_id, escopado à sessão — usa o prefixo
// session_id do índice @@unique([session_id, wa_message_id]) (O(1), sem seq
// scan). Usado pelo ack. NÃO faz fallback company-wide: sem índice em
// (company_id, wa_message_id), isso viraria um scan de tabela inteira no
// caminho quente do ack.
const findMessageByWaId = async (
  session: { id: string },
  waMessageId: string,
) =>
  prisma.whatsappMessage.findFirst({
    where: { session_id: session.id, wa_message_id: waMessageId },
  });

// Casa a mensagem-alvo de EDIÇÃO/EXCLUSÃO tolerando diferença de formato de id
// entre engines: alguns mandam o id COMPLETO ("true_..._SHORT") na mensagem e o
// id CURTO ("SHORT") no evento de edit/revoke (ou o inverso). Tenta, em ordem:
// id exato → id curto exato → sufixo "_SHORT". Tudo escopado à sessão (barato:
// edit/revoke são eventos raros).
const findMutableMessage = async (
  session: { id: string },
  targetId: string,
) => {
  const exact = await findMessageByWaId(session, targetId);
  if (exact) return exact;
  const shortId = targetId.split("_").pop() ?? targetId;
  if (shortId && shortId !== targetId) {
    const byShort = await findMessageByWaId(session, shortId);
    if (byShort) return byShort;
  }
  if (!shortId) return null;
  return prisma.whatsappMessage.findFirst({
    where: {
      session_id: session.id,
      wa_message_id: { endsWith: `_${shortId}` },
    },
    orderBy: { created_at: "desc" },
  });
};

// message.edited: atualiza o corpo e marca como editada (raw_data._edited),
// preservando o texto anterior. Emite message:updated.
const handleMessageEditEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  if (isNewsletterMessage(payload)) return;
  const targetId =
    payload.editedMessageId ||
    payload._data?.Message?.protocolMessage?.key?.ID ||
    payload.id;
  const newBody =
    payload.body ||
    payload._data?.Message?.protocolMessage?.editedMessage?.conversation ||
    payload._data?.Message?.protocolMessage?.editedMessage?.extendedTextMessage
      ?.text ||
    null;
  if (!targetId || !newBody) return;
  const target = await findMutableMessage(session, targetId);
  if (!target) return;
  const raw = ((target.raw_data as any) ?? {}) as Record<string, unknown>;
  const updated = await prisma.whatsappMessage.update({
    where: { id: target.id },
    data: {
      body: newBody,
      raw_data: {
        ...raw,
        _edited: {
          at: new Date().toISOString(),
          previous: target.body ?? null,
        },
      },
      updated_at: new Date(),
    },
  });
  emitToCompany(session.company_id, "message:updated", {
    conversationId: target.conversation_id,
    message: updated,
  });
};

// message.revoked: soft-delete (raw_data._deleted) — não apaga a linha, a UI
// mostra "mensagem apagada". Idempotente.
const handleMessageRevokeEvent = async (
  wahaSessionId: string,
  payload: WahaMessagePayload,
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const targetId = payload.revokedMessageId || payload.id;
  if (!targetId) return;
  const target = await findMutableMessage(session, targetId);
  if (!target) return;
  const raw = ((target.raw_data as any) ?? {}) as Record<string, unknown>;
  if (raw._deleted) return;
  const updated = await prisma.whatsappMessage.update({
    where: { id: target.id },
    data: {
      raw_data: {
        ...raw,
        _deleted: true,
        _deletedAt: new Date().toISOString(),
      },
      updated_at: new Date(),
    },
  });
  emitToCompany(session.company_id, "message:updated", {
    conversationId: target.conversation_id,
    message: updated,
  });
};

// lid.resolved: o WhatsApp revela o telefone real por trás de um @lid. Aprende
// o número no(s) contato(s) que estavam só com o LID — cura a ORIGEM do bug que
// o backfillLidPhones limpa depois. Payload: { lid, phoneNumber, identifier }.
const handleLidResolvedEvent = async (
  wahaSessionId: string,
  payload: { lid?: string; phoneNumber?: string; identifier?: string },
) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const lidLocal = (payload?.lid ?? "").replace(/\D/g, "");
  const canonical = formatBrazilianNumber(payload?.phoneNumber);
  if (!lidLocal || !canonical) return;
  const contacts = await prisma.whatsappContact.findMany({
    where: { company_id: session.company_id, wa_id: { startsWith: lidLocal } },
  });
  for (const c of contacts) {
    if (c.phone === canonical) continue;
    await prisma.whatsappContact.update({
      where: { id: c.id },
      data: { phone: canonical, updated_at: new Date() },
    });
  }
};

// session.deleted: o orchestrator removeu a sessão — marca desconectada/inativa
// (some da UI) e avisa em tempo real.
const handleSessionDeletedEvent = async (wahaSessionId: string) => {
  const session = await resolveSessionByWahaId(wahaSessionId);
  if (!session) return;
  const updated = await prisma.whatsappSession.update({
    where: { id: session.id },
    data: {
      status: WhatsappSessionStatus.disconnected,
      is_active: false,
      updated_at: new Date(),
    },
  });
  emitToCompany(session.company_id, "session:status", {
    sessionId: updated.id,
    wahaSessionId,
    status: updated.status,
    phoneNumber: updated.phone_number,
  });
};

// ============================================================
// Entry point
// ============================================================

export const processWebhookEvent = async (
  wahaSessionId: string,
  event: unknown,
) => {
  if (!event || typeof event !== "object") return;
  const e = event as { event?: string; payload?: any };
  switch (e.event) {
    case "message":
    case "message.any":
      if (e.payload) {
        // Se o payload eh uma reacao (vem dentro de "message" as vezes)
        if (e.payload.reaction) {
          await handleReactionEvent(wahaSessionId, e.payload);
        } else {
          await handleIncomingMessage(wahaSessionId, e.payload);
        }
      }
      break;
    case "message.ack":
    case "message.ack.group":
      if (e.payload) await handleAckEvent(wahaSessionId, e.payload);
      break;
    case "message.reaction":
      if (e.payload) await handleReactionEvent(wahaSessionId, e.payload);
      break;
    case "message.edited":
      if (e.payload) await handleMessageEditEvent(wahaSessionId, e.payload);
      break;
    case "message.revoked":
      if (e.payload) await handleMessageRevokeEvent(wahaSessionId, e.payload);
      break;
    case "lid.resolved":
      if (e.payload) await handleLidResolvedEvent(wahaSessionId, e.payload);
      break;
    case "session.status":
      // payload pode vir achatado ou aninhado conforme engine/versao
      await handleSessionStatusEvent(wahaSessionId, e.payload ?? e);
      break;
    case "session.deleted":
      await handleSessionDeletedEvent(wahaSessionId);
      break;
    case "presence.update":
    case "presence":
      if (e.payload) await handlePresenceEvent(wahaSessionId, e.payload);
      break;
    default:
      break;
  }
};

// ============================================================
// Chat REST API
// ============================================================

interface LinkedClientPreview {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

const buildClientPhoneMap = async (companyId: string) => {
  const clients = await prisma.client.findMany({
    where: { company_id: companyId },
    select: { id: true, name: true, phone: true, email: true },
  });
  const map = new Map<string, LinkedClientPreview>();
  for (const c of clients) {
    const key = normalizeDigits(c.phone);
    if (!key) continue;
    if (!map.has(key)) map.set(key, c);
  }
  return map;
};

export const listConversations = async (
  companyId: string,
  sessionId?: string,
) => {
  const [rows, clientMap] = await Promise.all([
    prisma.whatsappConversation.findMany({
      where: {
        company_id: companyId,
        ...(sessionId ? { session_id: sessionId } : {}),
        // Só conversa normal e grupo: esconde status/broadcast e canais.
        NOT: [
          { wa_chat_id: { endsWith: "@broadcast" } },
          { wa_chat_id: { endsWith: "@newsletter" } },
        ],
      },
      orderBy: [{ last_message_at: "desc" }, { created_at: "desc" }],
      include: {
        contact: {
          select: {
            id: true,
            wa_id: true,
            name: true,
            push_name: true,
            phone: true,
            profile_pic_url: true,
            client_link_blocked: true,
            client: {
              select: { id: true, name: true, phone: true, email: true },
            },
          },
        },
        group: {
          select: { id: true, name: true, profile_pic_url: true },
        },
        session: { select: { id: true, name: true, phone_number: true } },
      },
      take: 100,
    }),
    buildClientPhoneMap(companyId),
  ]);

  return rows.map((row) => {
    // Vínculo manual (contact.client) tem prioridade sobre o match por telefone.
    // Desvínculo explícito (client_link_blocked) impede o re-match automático.
    const explicit = row.contact?.client ?? null;
    const phoneKey = normalizeDigits(
      row.contact?.phone ?? row.wa_chat_id.split("@")[0],
    );
    const phoneMatch =
      !row.contact?.client_link_blocked && phoneKey
        ? (clientMap.get(phoneKey) ?? null)
        : null;
    const linkedClient = explicit ?? phoneMatch;
    return { ...row, linkedClient };
  });
};

// Mapa cliente→conversa do WhatsApp para a tela de Clientes (mostra a relação
// cliente ↔ contato ↔ conversa ↔ número). Vínculo explícito (contact.client_id)
// tem prioridade sobre o match por telefone, igual ao listConversations.
export interface ClientWhatsappLink {
  conversationId: string;
  waChatId: string;
  contactName: string;
  contactPhone: string | null;
  profilePicUrl: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
}

export const getClientWhatsappLinks = async (
  companyId: string,
): Promise<Record<string, ClientWhatsappLink>> => {
  const [rows, clientMap] = await Promise.all([
    prisma.whatsappConversation.findMany({
      where: {
        company_id: companyId,
        type: ConversationType.individual,
        NOT: [
          { wa_chat_id: { endsWith: "@broadcast" } },
          { wa_chat_id: { endsWith: "@newsletter" } },
        ],
      },
      orderBy: [{ last_message_at: "desc" }, { created_at: "desc" }],
      include: {
        contact: {
          select: {
            name: true,
            push_name: true,
            phone: true,
            profile_pic_url: true,
            client_id: true,
            client_link_blocked: true,
          },
        },
      },
    }),
    buildClientPhoneMap(companyId),
  ]);

  const out: Record<string, ClientWhatsappLink> = {};
  for (const row of rows) {
    const explicitId = row.contact?.client_id ?? null;
    const phoneKey = normalizeDigits(
      row.contact?.phone ?? row.wa_chat_id.split("@")[0],
    );
    const phoneMatchId =
      !row.contact?.client_link_blocked && phoneKey
        ? (clientMap.get(phoneKey)?.id ?? null)
        : null;
    const clientId = explicitId ?? phoneMatchId;
    if (!clientId || out[clientId]) continue; // rows ordenadas: 1ª = mais recente
    out[clientId] = {
      conversationId: row.id,
      waChatId: row.wa_chat_id,
      contactName:
        row.contact?.name?.trim() || row.contact?.push_name?.trim() || "",
      contactPhone: row.contact?.phone ?? null,
      profilePicUrl: row.contact?.profile_pic_url ?? null,
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at
        ? row.last_message_at.toISOString()
        : null,
    };
  }
  return out;
};

// ============================================================
// CRM bridge: criar cliente a partir do contato da conversa
// ============================================================

export const createClientFromConversation = async (
  convId: string,
  companyId: string,
  overrides?: { name?: string; email?: string },
) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: { contact: true },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  if (conv.type === "group") {
    const err: any = new Error("Cannot create client from group conversation");
    err.statusCode = 400;
    throw err;
  }

  const phone = conv.contact?.phone ?? phoneFromJid(conv.wa_chat_id);
  if (!phone) {
    const err: any = new Error("No phone available on conversation");
    err.statusCode = 400;
    throw err;
  }

  const name =
    overrides?.name?.trim() ||
    conv.contact?.push_name ||
    conv.contact?.name ||
    `Cliente WhatsApp ${phone}`;

  // Idempotente: se ja existe cliente com mesmo phone na company, retorna
  const existing = await prisma.client.findFirst({
    where: { company_id: companyId, phone },
  });
  if (existing) return existing;

  return prisma.client.create({
    data: {
      company_id: companyId,
      name,
      phone,
      email: overrides?.email ?? null,
    },
  });
};

// Exclui uma conversa e suas mensagens do inbox. O contato/cliente do CRM é
// preservado (só a thread some). Emite socket para a UI atualizar.
export const deleteConversation = async (convId: string, companyId: string) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  await prisma.whatsappMessage.deleteMany({
    where: { conversation_id: convId },
  });
  await prisma.whatsappConversation.delete({ where: { id: convId } });
  emitToCompany(companyId, "conversation:deleted", { conversationId: convId });
  return { id: convId };
};

// Define/edita o nome do contato de uma conversa (override manual). Resolve o
// problema de conversas aparecerem como número cru.
export const updateConversationContactName = async (
  convId: string,
  companyId: string,
  name: string,
) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  const trimmed = (name ?? "").trim();
  let contactId = conv.contact_id;
  if (!contactId) {
    if (conv.type === "group") {
      const err: any = new Error("Não é possível renomear um grupo por aqui");
      err.statusCode = 400;
      throw err;
    }
    const created = await prisma.whatsappContact.create({
      data: {
        id: randomUUID(),
        company_id: companyId,
        session_id: conv.session_id,
        wa_id: conv.wa_chat_id,
        phone: phoneFromJid(conv.wa_chat_id),
        name: trimmed || null,
      },
    });
    contactId = created.id;
    await prisma.whatsappConversation.update({
      where: { id: convId },
      data: { contact_id: contactId },
    });
  } else {
    await prisma.whatsappContact.update({
      where: { id: contactId },
      data: { name: trimmed || null, updated_at: new Date() },
    });
  }
  const fresh = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: {
      contact: {
        select: {
          id: true, wa_id: true, name: true, push_name: true,
          phone: true, profile_pic_url: true,
        },
      },
      group: { select: { id: true, name: true, profile_pic_url: true } },
      session: { select: { id: true, name: true, phone_number: true } },
    },
  });
  emitToCompany(companyId, "conversation:updated", { conversation: fresh });
  return fresh;
};

// Agendamentos do contato da conversa (match por telefone, últimos 10 dígitos).
// Dá à atendente o contexto do cliente direto no chat.
export const getConversationBookings = async (
  convId: string,
  companyId: string,
) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  const contact = conv.contact_id
    ? await prisma.whatsappContact.findUnique({ where: { id: conv.contact_id } })
    : null;
  const phone = contact?.phone || phoneFromJid(conv.wa_chat_id);
  const key = (phone || "").replace(/\D/g, "").slice(-10);
  if (!key) return [];

  const recent = await prisma.booking.findMany({
    where: { company_id: companyId, archived: false },
    orderBy: { booking_date: "desc" },
    take: 300,
    select: {
      id: true,
      client_name: true,
      client_phone: true,
      service: true,
      booking_date: true,
      booking_time: true,
      status: true,
    },
  });
  return recent
    .filter((b) => (b.client_phone || "").replace(/\D/g, "").slice(-10) === key)
    .slice(0, 20);
};

// Vincula (ou desvincula, clientId=null) a conversa a um cliente EXISTENTE do
// CRM, de forma explícita. Cria o contato se ainda não houver.
export const linkConversationToClient = async (
  convId: string,
  companyId: string,
  clientId: string | null,
) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.company_id !== companyId) {
      const err: any = new Error("Cliente não encontrado");
      err.statusCode = 404;
      throw err;
    }
  }
  let contactId = conv.contact_id;
  if (!contactId) {
    if (conv.type === "group") {
      const err: any = new Error("Grupos não vinculam a cliente");
      err.statusCode = 400;
      throw err;
    }
    const created = await prisma.whatsappContact.create({
      data: {
        id: randomUUID(),
        company_id: companyId,
        session_id: conv.session_id,
        wa_id: conv.wa_chat_id,
        phone: phoneFromJid(conv.wa_chat_id),
        client_id: clientId,
        // Desvincular (clientId null) bloqueia o re-match automático por telefone.
        client_link_blocked: clientId === null,
      },
    });
    contactId = created.id;
    await prisma.whatsappConversation.update({
      where: { id: convId },
      data: { contact_id: contactId },
    });
  } else {
    await prisma.whatsappContact.update({
      where: { id: contactId },
      data: {
        client_id: clientId,
        // Desvincular bloqueia o re-match; vincular de novo libera.
        client_link_blocked: clientId === null,
        updated_at: new Date(),
      },
    });
  }
  const fresh = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: {
      contact: {
        select: {
          id: true, wa_id: true, name: true, push_name: true,
          phone: true, profile_pic_url: true,
          client: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
      group: { select: { id: true, name: true, profile_pic_url: true } },
      session: { select: { id: true, name: true, phone_number: true } },
    },
  });
  const linkedClient = fresh?.contact?.client ?? null;
  const result = { ...fresh, linkedClient };
  emitToCompany(companyId, "conversation:updated", { conversation: result });
  return result;
};

const requireConversation = async (convId: string, companyId: string) => {
  const conv = await prisma.whatsappConversation.findUnique({
    where: { id: convId },
    include: { session: true },
  });
  if (!conv || conv.company_id !== companyId) {
    const err: any = new Error("Conversation not found");
    err.statusCode = 404;
    throw err;
  }
  return conv;
};

export const listMessages = async (
  convId: string,
  companyId: string,
  options: { limit?: number; before?: string } = {},
) => {
  await requireConversation(convId, companyId);
  const limit = Math.min(options.limit ?? 50, 200);
  return prisma.whatsappMessage.findMany({
    where: {
      conversation_id: convId,
      ...(options.before ? { timestamp: { lt: new Date(options.before) } } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
};

export const sendConversationMessage = async (
  convId: string,
  companyId: string,
  body: string,
  replyToWaMessageId?: string,
) => {
  const conv = await requireConversation(convId, companyId);

  // Se reply, busca a msg citada pra anexar preview
  let replyMeta: any = null;
  if (replyToWaMessageId) {
    // Busca a citada pela CONVERSA (não por session_id): mensagens da mesma
    // thread podem ter session_id diferente quando o envio caiu na sessão de
    // fallback após uma reconexão.
    const quoted = await prisma.whatsappMessage.findFirst({
      where: {
        conversation_id: conv.id,
        wa_message_id: replyToWaMessageId,
      },
    });
    if (quoted) {
      replyMeta = {
        messageId: replyToWaMessageId,
        body: quoted.body,
        from: quoted.from_number,
      };
    }
  }

  // Envia pela sessão viva da empresa (a da conversa pode ter morrido numa
  // reconexão). O placeholder é gravado sob a MESMA sessão do envio para o eco
  // do webhook reconciliar por (session_id, wa_message_id).
  const sendSession = await resolveSendSession(conv, companyId);
  await wahaOrchestrator.sendText(
    sendSession.waha_session_id,
    conv.wa_chat_id,
    body,
    replyToWaMessageId,
  );

  const now = new Date();
  const rawData: any = {};
  if (replyMeta) rawData._replyTo = replyMeta;

  const message = await prisma.whatsappMessage.create({
    data: {
      id: randomUUID(),
      company_id: companyId,
      session_id: sendSession.id,
      conversation_id: conv.id,
      wa_message_id: `local-${randomUUID()}`,
      direction: MessageDirection.outbound,
      status: MessageStatus.pending,
      to_number: phoneFromJid(conv.wa_chat_id),
      body,
      timestamp: now,
      raw_data: rawData,
    },
  });

  const updatedConv = await prisma.whatsappConversation.update({
    where: { id: conv.id },
    data: {
      last_message: body.slice(0, 200),
      last_message_at: now,
      updated_at: now,
    },
  });

  emitToCompany(companyId, "message:new", {
    conversationId: conv.id,
    message,
  });
  emitToCompany(companyId, "conversation:updated", {
    conversation: updatedConv,
  });

  return message;
};

// ============================================================
// React / Mark seen
// ============================================================

export const reactToMessage = async (
  convId: string,
  companyId: string,
  waMessageId: string,
  emoji: string,
) => {
  const conv = await requireConversation(convId, companyId);
  const sendSession = await resolveSendSession(conv, companyId);
  await wahaOrchestrator.sendReaction(
    sendSession.waha_session_id,
    conv.wa_chat_id,
    waMessageId,
    emoji,
  );
  // O webhook chega depois e atualiza raw_data._reactions
  return { ok: true };
};

export const sendChatSeen = async (convId: string, companyId: string) => {
  const conv = await requireConversation(convId, companyId);
  const sendSession = await resolveSendSession(conv, companyId);
  try {
    await wahaOrchestrator.sendSeen(
      sendSession.waha_session_id,
      conv.wa_chat_id,
    );
  } catch {
    // ignore — falha de sendSeen nao deve quebrar UX
  }
};

export const markConversationSeen = async (
  convId: string,
  companyId: string,
) => {
  const conv = await requireConversation(convId, companyId);
  // Manda sendSeen pro WhatsApp em background
  void sendChatSeen(convId, companyId).catch(() => undefined);
  if (conv.unread_count === 0) return conv;
  const updated = await prisma.whatsappConversation.update({
    where: { id: conv.id },
    data: { unread_count: 0, updated_at: new Date() },
  });
  emitToCompany(companyId, "conversation:updated", { conversation: updated });
  return updated;
};
