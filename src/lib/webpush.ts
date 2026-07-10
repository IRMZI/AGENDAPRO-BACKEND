import webpush from "web-push";

// Chaves VAPID (Web Push). Geradas com `npx web-push generate-vapid-keys`.
// Configure no ambiente (docker-compose / .env). Sem elas, o push fica
// desligado — as rotas respondem "enabled: false" e nenhum envio é tentado.
const publicKey = process.env.VAPID_PUBLIC_KEY || "";
const privateKey = process.env.VAPID_PRIVATE_KEY || "";
// "subject" precisa ser um mailto: ou uma URL. Contato do responsável pela app.
const subject =
  process.env.VAPID_SUBJECT || process.env.SMTP_FROM || "mailto:suporte@agendapro.app";

export const pushConfigured = Boolean(publicKey && privateKey);

if (pushConfigured) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ausentes — Web Push desativado.",
  );
}

export { webpush };
export const vapidPublicKey = publicKey;
