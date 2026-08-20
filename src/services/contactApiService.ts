// ============================================================================
// Notifica o contact-api externo quando um cadastro do teste grátis é concluído.
// ============================================================================
// Dispara um POST com os dados do lead (número + nome + infos do form). Best-effort
// e NÃO-bloqueante: falha/lentidão do contact-api NUNCA pode derrubar o cadastro
// (o mesmo cuidado do envio de WhatsApp/e-mail). Auth via header `api-key`.
//
// O token é SEGREDO → vem de env (CONTACT_API_TOKEN), como os outros segredos do
// projeto (JWT/S3/GROQ). Sem o token, vira no-op (o cadastro segue normal).

const CONTACT_API_URL =
  process.env.CONTACT_API_URL ||
  "https://system-api-production.up.railway.app/api/contact";
const CONTACT_API_TOKEN = process.env.CONTACT_API_TOKEN || "";

type ContactInput = {
  name: string;
  whatsapp: string;
  email?: string;
  business_name?: string;
  segment?: string;
  team_size?: string;
  instagram?: string;
};

// "(51) 99891-7243" → "5551998917243" (E.164 sem +). Prepende 55 se faltar.
const toInternational = (whatsapp: string) => {
  const digits = (whatsapp || "").replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
};

/** Fire-and-forget: chame SEM await. Já trata erro internamente (nunca lança). */
export const notifyContactApi = async (input: ContactInput): Promise<void> => {
  if (!CONTACT_API_TOKEN) {
    console.warn("[contact-api] CONTACT_API_TOKEN não configurado — pulando envio");
    return;
  }

  const payload = {
    number: toInternational(input.whatsapp),
    name: input.name,
    // Só as infos que o form coleta (sem cidade/estado/faturamento).
    additionalInfo: {
      email: input.email || undefined,
      negocio: input.business_name || undefined,
      segmento: input.segment || undefined,
      equipe: input.team_size || undefined,
      instagram: input.instagram || undefined,
    },
  };

  try {
    const res = await fetch(CONTACT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": CONTACT_API_TOKEN,
      },
      body: JSON.stringify(payload),
      // Não deixa uma resposta lenta segurar o processo (o signup já respondeu).
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[contact-api] falhou (${res.status}): ${body.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.error("[contact-api] erro no envio:", err?.message);
  }
};
