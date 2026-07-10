import { prisma } from "../lib/prisma.js";
import { webpush, pushConfigured } from "../lib/webpush.js";

// Formato que o browser entrega em PushManager.subscribe().toJSON().
type BrowserSubscription = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export type PushPayload = {
  title: string;
  body: string;
  /** Rota (relativa) aberta ao clicar na notificação — ex.: "/agenda". */
  url?: string;
  /** Agrupa/colapsa notificações repetidas do mesmo assunto. */
  tag?: string;
};

/**
 * Grava (ou atualiza) a inscrição de push de um usuário. A chave natural é o
 * endpoint — o mesmo device re-inscrevendo cai num upsert, evitando duplicatas
 * e mantendo a inscrição atrelada ao usuário logado no momento.
 */
export const saveSubscription = async (
  userId: string,
  sub: BrowserSubscription,
  userAgent?: string | null,
) => {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error("Assinatura de push inválida.");
  }
  return prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: userAgent ?? null,
    },
    update: {
      user_id: userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: userAgent ?? null,
      updated_at: new Date(),
    },
  });
};

/** Remove uma inscrição pelo endpoint (chamado quando o usuário desliga). */
export const deleteSubscription = async (endpoint: string) => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
};

/**
 * Envia uma notificação a TODAS as inscrições de um usuário (ele pode ter o app
 * instalado em vários devices). Best-effort: inscrições mortas (404/410) são
 * removidas automaticamente. Retorna quantos envios deram certo.
 */
export const sendPushToUser = async (
  userId: string,
  payload: PushPayload,
): Promise<number> => {
  if (!pushConfigured) return 0;

  const subs = await prisma.pushSubscription.findMany({
    where: { user_id: userId },
  });
  if (subs.length === 0) return 0;

  const data = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        sent += 1;
      } catch (err: any) {
        const code = err?.statusCode;
        // 404 = endpoint não existe mais; 410 = inscrição expirada/cancelada.
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.deleteMany({
            where: { endpoint: s.endpoint },
          });
        } else {
          // eslint-disable-next-line no-console
          console.error("[push] envio falhou:", code, err?.body || err?.message);
        }
      }
    }),
  );

  return sent;
};
