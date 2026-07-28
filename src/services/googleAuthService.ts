import { OAuth2Client } from "google-auth-library";

// ============================================================================
// Verificação server-side do ID token do Google (Google Identity Services).
// ============================================================================
// O front (landing/app) só DECODIFICA o JWT pra prefill — isso é confiável só
// pra UI. Para CRIAR CONTA / LOGAR a partir de "sou este email do Google", a
// verificação TEM que ser aqui: `verifyIdToken` valida assinatura (chaves da
// Google), `aud` (= nosso client id), `iss` e expiração. Sem isso qualquer um
// forjaria um token com o email que quisesse.

// Mesmo Client ID (público) do frontend — o `aud` do token TEM que bater. Env
// GOOGLE_CLIENT_ID tem prioridade; o fallback deixa funcionar sem setar no Railway.
const clientId =
  process.env.GOOGLE_CLIENT_ID ||
  "973305375212-3o9otn6q1aolei58lsqdn30icqiich8n.apps.googleusercontent.com";
const client = new OAuth2Client(clientId);

export type GoogleIdentity = {
  email: string;
  name: string;
  emailVerified: boolean;
  sub: string;
  picture?: string;
};

/** Erro com status/code p/ os controllers mapearem (em vez de virar 500). */
const googleError = (message: string, status: number, code: string) =>
  Object.assign(new Error(message), { status, code });

export const verifyGoogleCredential = async (
  idToken: string,
): Promise<GoogleIdentity> => {
  if (!clientId) {
    // Config do operador, não erro do cliente.
    throw googleError(
      "GOOGLE_CLIENT_ID não configurado no backend",
      500,
      "GOOGLE_NOT_CONFIGURED",
    );
  }
  if (!idToken) {
    throw googleError("Credencial do Google ausente.", 400, "GOOGLE_MISSING");
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({ idToken, audience: clientId });
  } catch {
    // Assinatura/aud/expiração inválidas: erro do cliente (401), não 500.
    throw googleError(
      "Não foi possível validar seu login com o Google. Tente de novo.",
      401,
      "GOOGLE_VERIFY_FAILED",
    );
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw googleError("Token do Google inválido.", 401, "GOOGLE_VERIFY_FAILED");
  }

  return {
    email: payload.email,
    name: payload.name || payload.given_name || "",
    emailVerified: payload.email_verified === true,
    sub: payload.sub,
    picture: payload.picture,
  };
};
