import type { Request, Response } from "express";
import {
  resolveCallerCompanyId,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  TrialError,
  getTrialStatus,
  resendSetupLink,
  signupTrial,
} from "../services/trialService.js";
import { isDefaultSenderCompany } from "../services/tenantService.js";

export const trialSignupHandler = async (req: Request, res: Response) => {
  try {
    const result = await signupTrial(req.body || {});
    // O link de acesso NÃO volta aqui de propósito: entregar só pelo WhatsApp
    // é o que verifica o número implicitamente (anti-abuso). Devolvemos apenas
    // o canal usado para a landing dar o recado certo.
    return res.status(201).json({
      data: {
        company_id: result.company_id,
        trial_ends_at: result.trial_ends_at,
        delivery: result.delivery,
      },
    });
  } catch (error: any) {
    if (error instanceof TrialError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
    }
    console.error("[trial] signup falhou:", error);
    return res.status(500).json({
      error: "Não foi possível criar seu teste agora. Tente novamente.",
      code: "TRIAL_SIGNUP_FAILED",
    });
  }
};

export const trialResendLinkHandler = async (req: Request, res: Response) => {
  const { identifier, email, whatsapp } = req.body || {};
  try {
    await resendSetupLink(identifier || email || whatsapp || "");
  } catch (error) {
    console.error("[trial] resend falhou:", error);
  }
  // Resposta SEMPRE genérica e 200: diferenciar "achei" de "não achei" viraria
  // um oráculo de enumeração de contas.
  return res.status(200).json({
    data: {
      message:
        "Se encontrarmos uma conta com esses dados, enviaremos o link de acesso.",
    },
  });
};

export const trialStatusHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    // resolveCallerCompanyId (e não req.user.company_id direto) p/ funcionar
    // também com token legado, que não carrega a claim.
    const companyId = await resolveCallerCompanyId(req);
    if (!companyId) {
      return res.status(200).json({ data: null });
    }
    return res.status(200).json({ data: await getTrialStatus(companyId) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * A empresa do caller é a conta de WhatsApp default do tenant? O app usa isso
 * para mostrar (ou não) a edição das mensagens de onboarding do teste grátis.
 */
export const trialSenderConfigHandler = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const companyId = await resolveCallerCompanyId(req);
    const isDefault = companyId
      ? await isDefaultSenderCompany(companyId)
      : false;
    return res.status(200).json({ data: { is_default_sender: isDefault } });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
