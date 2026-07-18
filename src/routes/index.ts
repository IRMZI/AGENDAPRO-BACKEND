import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { healthCheck } from "../controllers/healthController.js";
import { uploadImageHandler } from "../controllers/uploadController.js";
import { sendEmailHandler } from "../controllers/emailController.js";
import { getTodayAvailabilityHandler } from "../controllers/availabilityController.js";
import { searchClientsPublicHandler } from "../controllers/clientSearchController.js";
import {
  checkTokenHandler,
  useTokenHandler,
  getAllPreOnboardingsHandler,
  getPreOnboardingByTokenHandler,
  createPreOnboardingHandler,
  updatePreOnboardingHandler,
  deletePreOnboardingHandler,
} from "../controllers/preOnboardingController.js";
import {
  signInHandler,
  signUpHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  setPasswordHandler,
} from "../controllers/authController.js";
import {
  requireAuth,
  requireActiveCompany,
  requireRole,
  requireCompanyAccess,
  requireSelfUserParam,
  requireInternalSecret,
} from "../middleware/auth.js";
import {
  authLimiter,
  publicWriteLimiter,
  publicReadLimiter,
  trialSignupLimiter,
  uploadLimiter,
} from "../middleware/rateLimit.js";
import {
  trialResendLinkHandler,
  trialSenderConfigHandler,
  trialSignupHandler,
  trialStatusHandler,
} from "../controllers/trialController.js";
import {
  ownsBooking,
  ownsAttendant,
  ownsClient,
  ownsService,
  ownsServicePlan,
  ownsSubscription,
  ownsSubscriptionSession,
  ownsAttendantLink,
  ownsAttendantBanner,
  ownsAttendantByBody,
  requireOwnAttendantParam,
  requireOwnAttendantBody,
  restrictBookingToOwnAttendant,
} from "../middleware/ownership.js";
import {
  createCompanyHandler,
  getCompanyByIdHandler,
  getCompanyByUserIdHandler,
  getCompanyPermissionsHandler,
  isCompanyActiveHandler,
  updateCompanyHandler,
  updateCompanyPermissionsHandler,
  updateCompanyServicesHandler,
} from "../controllers/companyController.js";
import {
  createBookingHandler,
  getBookingsByCompanyHandler,
  getBookingsByDateRangeHandler,
  getAvailableTimeSlotsHandler,
  updateBookingStatusHandler,
  archiveBookingHandler,
  updateBookingHandler,
  deleteBookingHandler,
} from "../controllers/bookingController.js";
import {
  createAttendantHandler,
  deleteAttendantHandler,
  disableAttendantLoginHandler,
  enableAttendantLoginHandler,
  getAttendantByUsernameHandler,
  getAttendantsByCompanyHandler,
  getPublicAttendantsByCompanyHandler,
  getMyAttendantHandler,
  updateAttendantHandler,
  updateMyAttendantHandler,
} from "../controllers/attendantController.js";
import {
  createServiceHandler,
  deleteServiceHandler,
  getPlanByIdHandler,
  getPlansHandler,
  getServicesByCompanyHandler,
  getPublicServicesByCompanyHandler,
  updateServiceHandler,
} from "../controllers/serviceController.js";
import {
  getCompanyBusinessHoursHandler,
  getAttendantWeekdaysHandler,
  upsertAttendantWeekdayHandler,
  upsertCompanyBusinessHoursHandler,
} from "../controllers/availabilityConfigController.js";
import {
  createAttendantBannerHandler,
  createAttendantLinkHandler,
  deleteAttendantBannerHandler,
  deleteAttendantLinkHandler,
  getAttendantBannerHandler,
  getAttendantLinkHandler,
  getAttendantLinksHandler,
  updateAttendantBannerHandler,
  updateAttendantLinkHandler,
  upsertAttendantBannerHandler,
  upsertAttendantLinkHandler,
} from "../controllers/attendantContentController.js";
import {
  createClientHandler,
  deleteClientHandler,
  getClientBookingsHandler,
  getClientsByCompanyHandler,
  updateClientHandler,
  upsertClientHandler,
  upsertClientPublicHandler,
} from "../controllers/clientController.js";
import {
  createServicePlanHandler,
  deleteServicePlanHandler,
  getServicePlansByCompanyHandler,
  updateServicePlanHandler,
} from "../controllers/planController.js";
import {
  createClientSubscriptionHandler,
  getActiveSubscriptionsByCompanyHandler,
  getClientSubscriptionsHandler,
  getSubscriptionSummaryHandler,
  processBookingCompletionHandler,
  updateClientSubscriptionHandler,
} from "../controllers/subscriptionController.js";
import {
  archiveSessionHandler,
  createSubscriptionSessionHandler,
  getSessionsWithBookingsHandler,
  getSubscriptionSessionsHandler,
  markSessionAsCompletedHandler,
  scheduleSessionHandler,
  updateSessionStatusHandler,
  updateSubscriptionSessionHandler,
} from "../controllers/subscriptionSessionController.js";
import { suggestAttendantsHandler } from "../controllers/availabilityController.js";
import {
  createLeadHandler,
  getLeadsHandler,
} from "../controllers/leadController.js";
import {
  getAllTenantsHandler,
  getTenantBySlugHandler,
  getTenantByIdHandler,
  getTenantByDomainHandler,
  createTenantHandler,
  updateTenantHandler,
  deleteTenantHandler,
  seedTenantsHandler,
} from "../controllers/tenantController.js";
import {
  createSessionHandler,
  listSessionsHandler,
  sessionDisconnectHandler,
  sessionQrHandler,
  sessionSendHandler,
  sessionStatusHandler,
  updateReminderSettingsHandler,
} from "../controllers/whatsappController.js";
import {
  clientWhatsappLinksHandler,
  conversationBookingsHandler,
  createClientFromConversationHandler,
  deleteConversationHandler,
  linkClientHandler,
  listConversationsHandler,
  listMessagesHandler,
  markSeenHandler,
  reactMessageHandler,
  sendMessageHandler,
  updateContactNameHandler,
  webhookHandler,
} from "../controllers/whatsappChatController.js";
import {
  createTemplateHandler,
  deleteTemplateHandler,
  listTemplatesHandler,
  updateTemplateHandler,
} from "../controllers/messageTemplateController.js";
import {
  getSummaryHandler,
  getReportsHandler,
  listTransactionsHandler,
  createTransactionHandler,
  deleteTransactionHandler,
  getPaymentMethodsHandler,
  upsertPaymentMethodHandler,
  getCashRegisterHandler,
  openCashRegisterHandler,
  closeCashRegisterHandler,
  getPendingCommissionsHandler,
  listCommissionsHandler,
  payCommissionsHandler,
  listPayoutsHandler,
} from "../controllers/financialController.js";
import { aiChatHandler } from "../controllers/aiController.js";
import {
  getPublicKeyHandler,
  subscribeHandler,
  unsubscribeHandler,
  testPushHandler,
} from "../controllers/pushController.js";

const router = Router();

// ============================================================================
// Guards compartilhados
// ============================================================================
// REGRA: toda rota autenticada da empresa usa `authed` (= requireAuth +
// requireActiveCompany), para que teste expirado / conta suspensa não consiga
// mais operar a API — antes o bloqueio era só um modal no Dashboard.
//
// ISENÇÕES (usam requireAuth puro), senão o bloqueado não consegue nem ver a
// tela de "teste encerrado" nem voltar a pagar:
//   - GET /auth/me                      → o app inicializa a identidade por aqui
//   - GET /companies/user/:userId(+/active) e /permissions → bootstrap do AppData
//   - GET /trial/status                 → é a fonte da própria tela de bloqueio
//   - /push/public-key e /push/unsubscribe
//   - (futuro) POST /billing/checkout   → pagar PRECISA funcionar bloqueado
// Rotas de /auth/* e as de requireInternalSecret já são isentas por construção
// (não passam por requireAuth), então o operador sempre consegue reativar.
const authed = [requireAuth, requireActiveCompany] as const;

// Image uploads: in-memory multipart parsing (streamed straight to the bucket),
// 5MB cap, image types only. Multer errors are translated to a clean 400 by the
// wrapper below instead of falling through to the generic 500 handler.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP."));
    }
  },
});

const singleImage = (req: Request, res: Response, next: NextFunction) => {
  imageUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message =
        (err as { code?: string }).code === "LIMIT_FILE_SIZE"
          ? "Imagem muito grande. O limite é 5MB."
          : (err as Error).message || "Falha no upload da imagem.";
      return res.status(400).json({ error: message });
    }
    return next();
  });
};

router.get("/health", healthCheck);

// Authenticated image upload (owner or logged-in attendant) → { url }.
router.post("/uploads", ...authed, uploadLimiter, singleImage, uploadImageHandler);

router.post("/auth/signup", authLimiter, signUpHandler);
router.post("/auth/login", authLimiter, signInHandler);
router.post("/auth/refresh", authLimiter, refreshHandler);
router.post("/auth/logout", logoutHandler);
// Public: attendant sets their password from a one-time invite token, then is logged in.
router.post("/auth/set-password", authLimiter, setPasswordHandler);
// ISENTA: o app resolve a identidade por aqui. Bloquear = loop de login.
router.get("/auth/me", requireAuth, meHandler);

// Sending email is an authenticated, admin-only action — never an open relay.
router.post(
  "/emails/send",
  ...authed,
  requireRole("admin"),
  publicWriteLimiter,
  sendEmailHandler,
);
router.post("/availability/today", publicReadLimiter, getTodayAvailabilityHandler);
router.post("/availability/suggest", publicReadLimiter, suggestAttendantsHandler);
router.post(
  "/clients/search-public",
  publicReadLimiter,
  searchClientsPublicHandler,
);
router.post("/preonboarding/check", publicWriteLimiter, checkTokenHandler);
router.post("/preonboarding/use", publicWriteLimiter, useTokenHandler);
router.get("/preonboarding/token/:token", getPreOnboardingByTokenHandler);
router.get(
  "/preonboarding",
  ...authed,
  requireRole("admin"),
  getAllPreOnboardingsHandler,
);
router.post("/preonboarding", publicWriteLimiter, createPreOnboardingHandler);
router.patch(
  "/preonboarding/:id",
  ...authed,
  requireRole("admin"),
  updatePreOnboardingHandler,
);
router.delete(
  "/preonboarding/:id",
  ...authed,
  requireRole("admin"),
  deletePreOnboardingHandler,
);

// ============================================================================
// Teste grátis self-service (landing page → company com 7 dias)
// ============================================================================
// Público: cria User + Company de verdade → limiter próprio, bem mais apertado
// que o publicWriteLimiter. O link de acesso sai por WhatsApp (nunca na
// resposta), o que verifica o número implicitamente.
router.post("/trial/signup", trialSignupLimiter, trialSignupHandler);
// Recuperação do link ("não chegou" / token queimado). Resposta genérica.
router.post("/trial/resend-link", trialSignupLimiter, trialResendLinkHandler);
// ISENTA do requireActiveCompany: alimenta a tela de "teste encerrado".
router.get("/trial/status", requireAuth, trialStatusHandler);
// A company do caller é a conta de WhatsApp default? (mostra a edição das
// mensagens de onboarding). Passa pelo guard normal — só interessa a empresas
// ativas de qualquer forma.
router.get("/trial/sender-config", ...authed, trialSenderConfigHandler);

// Leads
router.post("/leads", publicWriteLimiter, createLeadHandler);
router.get("/leads", ...authed, requireRole("admin"), getLeadsHandler);

// Tenants (White-Label Products)
router.get("/tenants", getAllTenantsHandler);
router.get("/tenants/slug/:slug", getTenantBySlugHandler);
router.get("/tenants/domain/:domain", getTenantByDomainHandler);
router.get("/tenants/:id", getTenantByIdHandler);
router.post("/tenants", ...authed, requireRole("admin"), createTenantHandler);
router.put(
  "/tenants/:id",
  ...authed,
  requireRole("admin"),
  updateTenantHandler,
);
router.delete(
  "/tenants/:id",
  ...authed,
  requireRole("admin"),
  deleteTenantHandler,
);
// Seeding default tenants is an operator action — never publicly callable.
router.post("/tenants/seed", requireInternalSecret, seedTenantsHandler);

// Companies
router.post("/companies", ...authed, createCompanyHandler);
router.get(
  // ISENTA: o AppDataContext carrega a empresa por aqui — a tela de "teste
  // encerrado" precisa do nome/id dela pra renderizar.
  "/companies/user/:userId",
  requireAuth,
  requireSelfUserParam,
  getCompanyByUserIdHandler,
);
router.get("/companies/:companyId", getCompanyByIdHandler);
// Module permissions (feature flags) per company.
// Read: the company's own app reads these to gate modules.
router.get(
  // ISENTA: bootstrap do AppData (flags de módulo).
  "/companies/:companyId/permissions",
  requireAuth,
  requireCompanyAccess,
  getCompanyPermissionsHandler,
);
// Write: INTERNAL/operator only (tied to the plan) — never the company owner.
// Requires the x-internal-secret header (INTERNAL_ADMIN_SECRET).
router.patch(
  "/companies/:companyId/permissions",
  requireInternalSecret,
  updateCompanyPermissionsHandler,
);
router.patch(
  "/companies/:companyId/services",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  updateCompanyServicesHandler,
);
router.patch(
  "/companies/:companyId",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  updateCompanyHandler,
);
router.get(
  // ISENTA: é justamente a sonda de "minha conta está ativa?" — bloquear ela
  // faria o Dashboard nunca conseguir descobrir que está bloqueado.
  "/companies/user/:userId/active",
  requireAuth,
  requireSelfUserParam,
  isCompanyActiveHandler,
);

// Bookings — public create (customers book without an account); rate-limited.
router.post("/bookings", publicWriteLimiter, createBookingHandler);
router.get(
  "/bookings/company/:companyId",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  getBookingsByCompanyHandler,
);
// Shared agenda: both owner and attendants can read the company's bookings
// (read-only for attendants; writes below are still scoped to their own).
router.get(
  "/bookings/company/:companyId/range",
  ...authed,
  requireCompanyAccess,
  getBookingsByDateRangeHandler,
);
router.get(
  "/bookings/company/:companyId/available-slots",
  getAvailableTimeSlotsHandler,
);
router.patch(
  "/bookings/:bookingId/status",
  ...authed,
  ownsBooking,
  restrictBookingToOwnAttendant,
  updateBookingStatusHandler,
);
router.patch(
  "/bookings/:bookingId/archive",
  ...authed,
  ownsBooking,
  restrictBookingToOwnAttendant,
  archiveBookingHandler,
);
// Edit / delete a booking (own-only for attendants; any for owner).
router.patch(
  "/bookings/:bookingId",
  ...authed,
  ownsBooking,
  restrictBookingToOwnAttendant,
  updateBookingHandler,
);
router.delete(
  "/bookings/:bookingId",
  ...authed,
  ownsBooking,
  restrictBookingToOwnAttendant,
  deleteBookingHandler,
);

// Attendants
// Roster is readable by attendants too (shared agenda needs the names);
// all mutations below remain admin-only.
router.get(
  "/attendants/company/:companyId",
  ...authed,
  requireCompanyAccess,
  getAttendantsByCompanyHandler,
);
// Public roster for the company booking page (anonymous visitors).
router.get(
  "/attendants/company/:companyId/public",
  publicReadLimiter,
  getPublicAttendantsByCompanyHandler,
);
// Attendant fetches only their own record (no roster exposure).
router.get("/attendants/me", ...authed, getMyAttendantHandler);
// Attendant self-service: edit own public profile (photo + social links).
// Must stay above "/attendants/:attendantId" so "me" isn't read as an id.
router.patch("/attendants/me", ...authed, updateMyAttendantHandler);
router.post(
  "/attendants",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  createAttendantHandler,
);
router.patch(
  "/attendants/:attendantId",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  updateAttendantHandler,
);
router.delete(
  "/attendants/:attendantId",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  deleteAttendantHandler,
);
// Owner enables/disables a per-attendant login (sends a set-password invite).
router.post(
  "/attendants/:attendantId/enable-login",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  enableAttendantLoginHandler,
);
router.post(
  "/attendants/:attendantId/disable-login",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  disableAttendantLoginHandler,
);
router.get("/attendants/by-username", getAttendantByUsernameHandler);

// Services and plans
router.get("/plans", getPlansHandler);
router.get("/plans/:planId", getPlanByIdHandler);
router.get(
  "/services/company/:companyId",
  ...authed,
  requireCompanyAccess,
  getServicesByCompanyHandler,
);
// Public list for the booking page (anonymous visitors) — display-safe fields only.
router.get(
  "/services/company/:companyId/public",
  publicReadLimiter,
  getPublicServicesByCompanyHandler,
);
router.post(
  "/services",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  createServiceHandler,
);
router.patch(
  "/services/:serviceId",
  ...authed,
  requireRole("admin"),
  ownsService,
  updateServiceHandler,
);
router.delete(
  "/services/:serviceId",
  ...authed,
  requireRole("admin"),
  ownsService,
  deleteServiceHandler,
);

// Business hours and weekdays
router.get(
  "/business-hours/company/:companyId",
  ...authed,
  requireCompanyAccess,
  getCompanyBusinessHoursHandler,
);
router.put(
  "/business-hours",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  upsertCompanyBusinessHoursHandler,
);
router.get(
  "/attendants/:attendantId/weekdays",
  ...authed,
  ownsAttendant,
  requireOwnAttendantParam,
  getAttendantWeekdaysHandler,
);
router.put(
  "/attendant-weekdays",
  ...authed,
  ownsAttendantByBody,
  requireOwnAttendantBody,
  upsertAttendantWeekdayHandler,
);

// Attendant links/banners
router.get(
  "/attendants/:attendantId/links",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  getAttendantLinksHandler,
);
router.get("/attendants/:attendantId/link", getAttendantLinkHandler);
router.post(
  "/attendants/links",
  ...authed,
  requireRole("admin"),
  ownsAttendantByBody,
  createAttendantLinkHandler,
);
router.patch(
  "/attendants/links/:linkId",
  ...authed,
  requireRole("admin"),
  ownsAttendantLink,
  updateAttendantLinkHandler,
);
router.delete(
  "/attendants/links/:linkId",
  ...authed,
  requireRole("admin"),
  ownsAttendantLink,
  deleteAttendantLinkHandler,
);
router.put(
  "/attendants/links",
  ...authed,
  requireRole("admin"),
  ownsAttendantByBody,
  upsertAttendantLinkHandler,
);

router.get(
  "/attendants/:attendantId/banner",
  ...authed,
  requireRole("admin"),
  ownsAttendant,
  getAttendantBannerHandler,
);
router.post(
  "/attendants/banners",
  ...authed,
  requireRole("admin"),
  ownsAttendantByBody,
  createAttendantBannerHandler,
);
router.patch(
  "/attendants/banners/:bannerId",
  ...authed,
  requireRole("admin"),
  ownsAttendantBanner,
  updateAttendantBannerHandler,
);
router.delete(
  "/attendants/banners/:bannerId",
  ...authed,
  requireRole("admin"),
  ownsAttendantBanner,
  deleteAttendantBannerHandler,
);
router.put(
  "/attendants/banners",
  ...authed,
  requireRole("admin"),
  ownsAttendantByBody,
  upsertAttendantBannerHandler,
);

// Clients
router.get(
  "/clients/company/:companyId",
  ...authed,
  requireCompanyAccess,
  getClientsByCompanyHandler,
);
router.post("/clients", ...authed, requireCompanyAccess, createClientHandler);
router.post(
  "/clients/upsert",
  ...authed,
  requireCompanyAccess,
  upsertClientHandler,
);
router.post("/clients/upsert-public", publicWriteLimiter, upsertClientPublicHandler);
// Client maintenance is available to attendants too (own-company scoped).
router.patch(
  "/clients/:clientId",
  ...authed,
  ownsClient,
  updateClientHandler,
);
router.delete(
  "/clients/:clientId",
  ...authed,
  ownsClient,
  deleteClientHandler,
);
router.get(
  "/clients/:clientId/bookings",
  ...authed,
  ownsClient,
  getClientBookingsHandler,
);

// Service plans
router.get(
  "/service-plans/company/:companyId",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  getServicePlansByCompanyHandler,
);
router.post(
  "/service-plans",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  createServicePlanHandler,
);
router.patch(
  "/service-plans/:planId",
  ...authed,
  requireRole("admin"),
  ownsServicePlan,
  updateServicePlanHandler,
);
router.delete(
  "/service-plans/:planId",
  ...authed,
  requireRole("admin"),
  ownsServicePlan,
  deleteServicePlanHandler,
);

// Subscriptions
router.get(
  "/subscriptions/client/:clientId",
  ...authed,
  requireRole("admin"),
  ownsClient,
  getClientSubscriptionsHandler,
);
router.get(
  "/subscriptions/company/:companyId/active",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  getActiveSubscriptionsByCompanyHandler,
);
router.post(
  "/subscriptions",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  createClientSubscriptionHandler,
);
router.patch(
  "/subscriptions/:subscriptionId",
  ...authed,
  requireRole("admin"),
  ownsSubscription,
  updateClientSubscriptionHandler,
);
router.post(
  "/subscriptions/process-booking",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  processBookingCompletionHandler,
);
router.get(
  "/subscriptions/:subscriptionId/summary",
  ...authed,
  requireRole("admin"),
  ownsSubscription,
  getSubscriptionSummaryHandler,
);

// Subscription sessions
router.get(
  "/subscription-sessions/subscription/:subscriptionId",
  ...authed,
  requireRole("admin"),
  ownsSubscription,
  getSubscriptionSessionsHandler,
);
router.post(
  "/subscription-sessions",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  createSubscriptionSessionHandler,
);
router.patch(
  "/subscription-sessions/:sessionId",
  ...authed,
  requireRole("admin"),
  ownsSubscriptionSession,
  updateSubscriptionSessionHandler,
);
router.post(
  "/subscription-sessions/:sessionId/complete",
  ...authed,
  requireRole("admin"),
  ownsSubscriptionSession,
  markSessionAsCompletedHandler,
);
router.post(
  "/subscription-sessions/:sessionId/schedule",
  ...authed,
  requireRole("admin"),
  ownsSubscriptionSession,
  scheduleSessionHandler,
);
router.get(
  "/subscription-sessions/company/:companyId/with-bookings",
  ...authed,
  requireRole("admin"),
  requireCompanyAccess,
  getSessionsWithBookingsHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/status",
  ...authed,
  requireRole("admin"),
  ownsSubscriptionSession,
  updateSessionStatusHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/archive",
  ...authed,
  requireRole("admin"),
  ownsSubscriptionSession,
  archiveSessionHandler,
);

// WhatsApp - multi-session por empresa via WahaOrchestrator
router.get("/whatsapp", ...authed, requireRole("admin"), listSessionsHandler);
router.post("/whatsapp", ...authed, requireRole("admin"), createSessionHandler);

// Webhook recebido dos workers WAHA (sem JWT - valida secret)
router.post("/whatsapp/webhook/:wahaSessionId", webhookHandler);

// Configuração do lembrete de agendamento (horas antes)
router.patch(
  "/whatsapp/reminder-settings",
  ...authed,
  requireRole("admin"),
  updateReminderSettingsHandler,
);

// Sessions
router.get("/whatsapp/:id/qr", ...authed, requireRole("admin"), sessionQrHandler);
router.get(
  "/whatsapp/:id/status",
  ...authed,
  requireRole("admin"),
  sessionStatusHandler,
);
router.post(
  "/whatsapp/:id/disconnect",
  ...authed,
  requireRole("admin"),
  sessionDisconnectHandler,
);
router.post(
  "/whatsapp/:id/send",
  ...authed,
  requireRole("admin"),
  sessionSendHandler,
);

// Chat (conversas + mensagens)
router.get(
  "/whatsapp/client-links",
  ...authed,
  requireRole("admin"),
  clientWhatsappLinksHandler,
);
router.get(
  "/whatsapp/conversations",
  ...authed,
  requireRole("admin"),
  listConversationsHandler,
);
router.get(
  "/whatsapp/conversations/:convId/messages",
  ...authed,
  requireRole("admin"),
  listMessagesHandler,
);
router.post(
  "/whatsapp/conversations/:convId/send",
  ...authed,
  requireRole("admin"),
  sendMessageHandler,
);
router.post(
  "/whatsapp/conversations/:convId/seen",
  ...authed,
  requireRole("admin"),
  markSeenHandler,
);
router.post(
  "/whatsapp/conversations/:convId/create-client",
  ...authed,
  requireRole("admin"),
  createClientFromConversationHandler,
);
router.patch(
  "/whatsapp/conversations/:convId/contact",
  ...authed,
  requireRole("admin"),
  updateContactNameHandler,
);
router.get(
  "/whatsapp/conversations/:convId/bookings",
  ...authed,
  requireRole("admin"),
  conversationBookingsHandler,
);
router.patch(
  "/whatsapp/conversations/:convId/link-client",
  ...authed,
  requireRole("admin"),
  linkClientHandler,
);
router.post(
  "/whatsapp/conversations/:convId/react",
  ...authed,
  requireRole("admin"),
  reactMessageHandler,
);
router.delete(
  "/whatsapp/conversations/:convId",
  ...authed,
  requireRole("admin"),
  deleteConversationHandler,
);

// Respostas rápidas / templates de mensagem (company-scoped)
router.get(
  "/message-templates",
  ...authed,
  requireRole("admin"),
  listTemplatesHandler,
);
router.post(
  "/message-templates",
  ...authed,
  requireRole("admin"),
  createTemplateHandler,
);
router.patch(
  "/message-templates/:id",
  ...authed,
  requireRole("admin"),
  updateTemplateHandler,
);
router.delete(
  "/message-templates/:id",
  ...authed,
  requireRole("admin"),
  deleteTemplateHandler,
);

// ============================================================================
// Financial module (admin-only, company-scoped)
// ============================================================================
const fin = [
  requireAuth,
  requireActiveCompany,
  requireRole("admin"),
  requireCompanyAccess,
] as const;

router.get("/financial/summary/:companyId", ...fin, getSummaryHandler);
router.get("/financial/reports/:companyId", ...fin, getReportsHandler);

router.get("/financial/transactions/:companyId", ...fin, listTransactionsHandler);
router.post("/financial/transactions", ...fin, createTransactionHandler);
router.delete("/financial/transactions/:id", ...fin, deleteTransactionHandler);

router.get(
  "/financial/payment-methods/:companyId",
  ...fin,
  getPaymentMethodsHandler,
);
router.post("/financial/payment-methods", ...fin, upsertPaymentMethodHandler);

router.get("/financial/cash-register/:companyId", ...fin, getCashRegisterHandler);
router.post("/financial/cash-register/open", ...fin, openCashRegisterHandler);
router.post(
  "/financial/cash-register/:registerId/close",
  ...fin,
  closeCashRegisterHandler,
);

router.get(
  "/financial/commissions/:companyId/pending",
  ...fin,
  getPendingCommissionsHandler,
);
router.get("/financial/commissions/:companyId", ...fin, listCommissionsHandler);
router.post("/financial/commissions/pay", ...fin, payCommissionsHandler);
router.get("/financial/payouts/:companyId", ...fin, listPayoutsHandler);

// ============================================================================
// AI assistant (Groq) — owner-only; company derived from the token; tools are
// company-scoped. A 15s per-company cooldown is enforced inside the handler.
// ============================================================================
router.post("/ai/chat", ...authed, requireRole("admin"), aiChatHandler);

// ============================================================================
// Web Push (PWA) — inscrição de notificações por usuário autenticado.
// A chave pública VAPID é servida pelo backend p/ o frontend não precisar de
// rebuild ao rotacionar a chave. Todas as rotas exigem login.
// ============================================================================
// ISENTAS: a chave pública é inócua e cancelar inscrição tem que funcionar
// sempre (inclusive p/ parar de notificar uma conta bloqueada).
router.get("/push/public-key", requireAuth, getPublicKeyHandler);
router.post("/push/unsubscribe", requireAuth, unsubscribeHandler);
router.post("/push/subscribe", ...authed, subscribeHandler);
router.post("/push/test", ...authed, testPushHandler);

export default router;
