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
  signupTrialWithGoogle,
  startTrialVerification,
} from "../services/trialService.js";
import { EmailVerificationError } from "../services/emailVerificationService.js";
import { isDefaultSenderCompany } from "../services/tenantService.js";

/**
 * Mapeia os erros esperados do cadastro para o status certo. TrialError e
 * EmailVerificationError carregam status+code; erros do Google (googleAuthService)
 * também têm status+code anexados. Qualquer outra coisa é 500 com log.
 */
const respondTrialError = (res: Response, error: any, logPrefix: string) => {
  const status =
    error instanceof TrialError || error instanceof EmailVerificationError
      ? error.status
      : typeof error?.status === "number"
        ? error.status
        : null;
  // Só ecoa erro do CLIENTE (4xx) com mensagem/code. 5xx e desconhecidos viram
  // genérico — não vaza detalhe interno (ex.: config do Google) pro usuário.
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: error.message, code: error.code });
  }
  console.error(logPrefix, error);
  return res.status(500).json({
    error: "Não foi possível criar seu teste agora. Tente novamente.",
    code: "TRIAL_SIGNUP_FAILED",
  });
};

export const trialSignupHandler = async (req: Request, res: Response) => {
  try {
    const result = await signupTrial(req.body || {});
    // Acesso imediato: devolvemos o handoff + a URL do app já com o código. O
    // refresh token NÃO anda aqui — o handoff é curto e de uso único.
    return res.status(201).json({
      data: {
        company_id: result.company_id,
        trial_ends_at: result.trial_ends_at,
        handoff_code: result.handoff_code,
        redirect_url: result.redirect_url,
      },
    });
  } catch (error: any) {
    return respondTrialError(res, error, "[trial] signup falhou:");
  }
};

/**
 * Passo 1 do cadastro manual: dispara o código de verificação no email. Barra
 * duplicados (409) ANTES de gastar um código — daí a landing consegue avisar
 * "já tem conta, faça login".
 */
export const trialStartVerificationHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    await startTrialVerification(req.body || {});
    return res.status(200).json({
      data: { message: "Enviamos um código para o seu e-mail." },
    });
  } catch (error: any) {
    return respondTrialError(res, error, "[trial] start-verification falhou:");
  }
};

/**
 * Cadastro/login via Google (landing). Pode devolver { needs_profile } (conta
 * nova sem os dados do negócio ainda) ou { redirect_url } (logado → handoff).
 */
export const trialGoogleHandler = async (req: Request, res: Response) => {
  try {
    const result = await signupTrialWithGoogle(req.body || {});
    return res.status(200).json({ data: result });
  } catch (error: any) {
    return respondTrialError(res, error, "[trial] google falhou:");
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
