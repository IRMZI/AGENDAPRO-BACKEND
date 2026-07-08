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
  requireRole,
  requireCompanyAccess,
  requireSelfUserParam,
  requireInternalSecret,
} from "../middleware/auth.js";
import {
  authLimiter,
  publicWriteLimiter,
  publicReadLimiter,
  uploadLimiter,
} from "../middleware/rateLimit.js";
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

const router = Router();

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
router.post("/uploads", requireAuth, uploadLimiter, singleImage, uploadImageHandler);

router.post("/auth/signup", authLimiter, signUpHandler);
router.post("/auth/login", authLimiter, signInHandler);
router.post("/auth/refresh", authLimiter, refreshHandler);
router.post("/auth/logout", logoutHandler);
// Public: attendant sets their password from a one-time invite token, then is logged in.
router.post("/auth/set-password", authLimiter, setPasswordHandler);
router.get("/auth/me", requireAuth, meHandler);

// Sending email is an authenticated, admin-only action — never an open relay.
router.post(
  "/emails/send",
  requireAuth,
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
  requireAuth,
  requireRole("admin"),
  getAllPreOnboardingsHandler,
);
router.post("/preonboarding", publicWriteLimiter, createPreOnboardingHandler);
router.patch(
  "/preonboarding/:id",
  requireAuth,
  requireRole("admin"),
  updatePreOnboardingHandler,
);
router.delete(
  "/preonboarding/:id",
  requireAuth,
  requireRole("admin"),
  deletePreOnboardingHandler,
);

// Leads
router.post("/leads", publicWriteLimiter, createLeadHandler);
router.get("/leads", requireAuth, requireRole("admin"), getLeadsHandler);

// Tenants (White-Label Products)
router.get("/tenants", getAllTenantsHandler);
router.get("/tenants/slug/:slug", getTenantBySlugHandler);
router.get("/tenants/domain/:domain", getTenantByDomainHandler);
router.get("/tenants/:id", getTenantByIdHandler);
router.post("/tenants", requireAuth, requireRole("admin"), createTenantHandler);
router.put(
  "/tenants/:id",
  requireAuth,
  requireRole("admin"),
  updateTenantHandler,
);
router.delete(
  "/tenants/:id",
  requireAuth,
  requireRole("admin"),
  deleteTenantHandler,
);
// Seeding default tenants is an operator action — never publicly callable.
router.post("/tenants/seed", requireInternalSecret, seedTenantsHandler);

// Companies
router.post("/companies", requireAuth, createCompanyHandler);
router.get(
  "/companies/user/:userId",
  requireAuth,
  requireSelfUserParam,
  getCompanyByUserIdHandler,
);
router.get("/companies/:companyId", getCompanyByIdHandler);
// Module permissions (feature flags) per company.
// Read: the company's own app reads these to gate modules.
router.get(
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
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  updateCompanyServicesHandler,
);
router.patch(
  "/companies/:companyId",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  updateCompanyHandler,
);
router.get(
  "/companies/user/:userId/active",
  requireAuth,
  requireSelfUserParam,
  isCompanyActiveHandler,
);

// Bookings — public create (customers book without an account); rate-limited.
router.post("/bookings", publicWriteLimiter, createBookingHandler);
router.get(
  "/bookings/company/:companyId",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  getBookingsByCompanyHandler,
);
// Shared agenda: both owner and attendants can read the company's bookings
// (read-only for attendants; writes below are still scoped to their own).
router.get(
  "/bookings/company/:companyId/range",
  requireAuth,
  requireCompanyAccess,
  getBookingsByDateRangeHandler,
);
router.get(
  "/bookings/company/:companyId/available-slots",
  getAvailableTimeSlotsHandler,
);
router.patch(
  "/bookings/:bookingId/status",
  requireAuth,
  ownsBooking,
  restrictBookingToOwnAttendant,
  updateBookingStatusHandler,
);
router.patch(
  "/bookings/:bookingId/archive",
  requireAuth,
  ownsBooking,
  restrictBookingToOwnAttendant,
  archiveBookingHandler,
);
// Edit / delete a booking (own-only for attendants; any for owner).
router.patch(
  "/bookings/:bookingId",
  requireAuth,
  ownsBooking,
  restrictBookingToOwnAttendant,
  updateBookingHandler,
);
router.delete(
  "/bookings/:bookingId",
  requireAuth,
  ownsBooking,
  restrictBookingToOwnAttendant,
  deleteBookingHandler,
);

// Attendants
// Roster is readable by attendants too (shared agenda needs the names);
// all mutations below remain admin-only.
router.get(
  "/attendants/company/:companyId",
  requireAuth,
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
router.get("/attendants/me", requireAuth, getMyAttendantHandler);
// Attendant self-service: edit own public profile (photo + social links).
// Must stay above "/attendants/:attendantId" so "me" isn't read as an id.
router.patch("/attendants/me", requireAuth, updateMyAttendantHandler);
router.post(
  "/attendants",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  createAttendantHandler,
);
router.patch(
  "/attendants/:attendantId",
  requireAuth,
  requireRole("admin"),
  ownsAttendant,
  updateAttendantHandler,
);
router.delete(
  "/attendants/:attendantId",
  requireAuth,
  requireRole("admin"),
  ownsAttendant,
  deleteAttendantHandler,
);
// Owner enables/disables a per-attendant login (sends a set-password invite).
router.post(
  "/attendants/:attendantId/enable-login",
  requireAuth,
  requireRole("admin"),
  ownsAttendant,
  enableAttendantLoginHandler,
);
router.post(
  "/attendants/:attendantId/disable-login",
  requireAuth,
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
  requireAuth,
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
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  createServiceHandler,
);
router.patch(
  "/services/:serviceId",
  requireAuth,
  requireRole("admin"),
  ownsService,
  updateServiceHandler,
);
router.delete(
  "/services/:serviceId",
  requireAuth,
  requireRole("admin"),
  ownsService,
  deleteServiceHandler,
);

// Business hours and weekdays
router.get(
  "/business-hours/company/:companyId",
  requireAuth,
  requireCompanyAccess,
  getCompanyBusinessHoursHandler,
);
router.put(
  "/business-hours",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  upsertCompanyBusinessHoursHandler,
);
router.get(
  "/attendants/:attendantId/weekdays",
  requireAuth,
  ownsAttendant,
  requireOwnAttendantParam,
  getAttendantWeekdaysHandler,
);
router.put(
  "/attendant-weekdays",
  requireAuth,
  ownsAttendantByBody,
  requireOwnAttendantBody,
  upsertAttendantWeekdayHandler,
);

// Attendant links/banners
router.get(
  "/attendants/:attendantId/links",
  requireAuth,
  requireRole("admin"),
  ownsAttendant,
  getAttendantLinksHandler,
);
router.get("/attendants/:attendantId/link", getAttendantLinkHandler);
router.post(
  "/attendants/links",
  requireAuth,
  requireRole("admin"),
  ownsAttendantByBody,
  createAttendantLinkHandler,
);
router.patch(
  "/attendants/links/:linkId",
  requireAuth,
  requireRole("admin"),
  ownsAttendantLink,
  updateAttendantLinkHandler,
);
router.delete(
  "/attendants/links/:linkId",
  requireAuth,
  requireRole("admin"),
  ownsAttendantLink,
  deleteAttendantLinkHandler,
);
router.put(
  "/attendants/links",
  requireAuth,
  requireRole("admin"),
  ownsAttendantByBody,
  upsertAttendantLinkHandler,
);

router.get(
  "/attendants/:attendantId/banner",
  requireAuth,
  requireRole("admin"),
  ownsAttendant,
  getAttendantBannerHandler,
);
router.post(
  "/attendants/banners",
  requireAuth,
  requireRole("admin"),
  ownsAttendantByBody,
  createAttendantBannerHandler,
);
router.patch(
  "/attendants/banners/:bannerId",
  requireAuth,
  requireRole("admin"),
  ownsAttendantBanner,
  updateAttendantBannerHandler,
);
router.delete(
  "/attendants/banners/:bannerId",
  requireAuth,
  requireRole("admin"),
  ownsAttendantBanner,
  deleteAttendantBannerHandler,
);
router.put(
  "/attendants/banners",
  requireAuth,
  requireRole("admin"),
  ownsAttendantByBody,
  upsertAttendantBannerHandler,
);

// Clients
router.get(
  "/clients/company/:companyId",
  requireAuth,
  requireCompanyAccess,
  getClientsByCompanyHandler,
);
router.post("/clients", requireAuth, requireCompanyAccess, createClientHandler);
router.post(
  "/clients/upsert",
  requireAuth,
  requireCompanyAccess,
  upsertClientHandler,
);
router.post("/clients/upsert-public", publicWriteLimiter, upsertClientPublicHandler);
// Client maintenance is available to attendants too (own-company scoped).
router.patch(
  "/clients/:clientId",
  requireAuth,
  ownsClient,
  updateClientHandler,
);
router.delete(
  "/clients/:clientId",
  requireAuth,
  ownsClient,
  deleteClientHandler,
);
router.get(
  "/clients/:clientId/bookings",
  requireAuth,
  ownsClient,
  getClientBookingsHandler,
);

// Service plans
router.get(
  "/service-plans/company/:companyId",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  getServicePlansByCompanyHandler,
);
router.post(
  "/service-plans",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  createServicePlanHandler,
);
router.patch(
  "/service-plans/:planId",
  requireAuth,
  requireRole("admin"),
  ownsServicePlan,
  updateServicePlanHandler,
);
router.delete(
  "/service-plans/:planId",
  requireAuth,
  requireRole("admin"),
  ownsServicePlan,
  deleteServicePlanHandler,
);

// Subscriptions
router.get(
  "/subscriptions/client/:clientId",
  requireAuth,
  requireRole("admin"),
  ownsClient,
  getClientSubscriptionsHandler,
);
router.get(
  "/subscriptions/company/:companyId/active",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  getActiveSubscriptionsByCompanyHandler,
);
router.post(
  "/subscriptions",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  createClientSubscriptionHandler,
);
router.patch(
  "/subscriptions/:subscriptionId",
  requireAuth,
  requireRole("admin"),
  ownsSubscription,
  updateClientSubscriptionHandler,
);
router.post(
  "/subscriptions/process-booking",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  processBookingCompletionHandler,
);
router.get(
  "/subscriptions/:subscriptionId/summary",
  requireAuth,
  requireRole("admin"),
  ownsSubscription,
  getSubscriptionSummaryHandler,
);

// Subscription sessions
router.get(
  "/subscription-sessions/subscription/:subscriptionId",
  requireAuth,
  requireRole("admin"),
  ownsSubscription,
  getSubscriptionSessionsHandler,
);
router.post(
  "/subscription-sessions",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  createSubscriptionSessionHandler,
);
router.patch(
  "/subscription-sessions/:sessionId",
  requireAuth,
  requireRole("admin"),
  ownsSubscriptionSession,
  updateSubscriptionSessionHandler,
);
router.post(
  "/subscription-sessions/:sessionId/complete",
  requireAuth,
  requireRole("admin"),
  ownsSubscriptionSession,
  markSessionAsCompletedHandler,
);
router.post(
  "/subscription-sessions/:sessionId/schedule",
  requireAuth,
  requireRole("admin"),
  ownsSubscriptionSession,
  scheduleSessionHandler,
);
router.get(
  "/subscription-sessions/company/:companyId/with-bookings",
  requireAuth,
  requireRole("admin"),
  requireCompanyAccess,
  getSessionsWithBookingsHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/status",
  requireAuth,
  requireRole("admin"),
  ownsSubscriptionSession,
  updateSessionStatusHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/archive",
  requireAuth,
  requireRole("admin"),
  ownsSubscriptionSession,
  archiveSessionHandler,
);

// WhatsApp - multi-session por empresa via WahaOrchestrator
router.get("/whatsapp", requireAuth, requireRole("admin"), listSessionsHandler);
router.post("/whatsapp", requireAuth, requireRole("admin"), createSessionHandler);

// Webhook recebido dos workers WAHA (sem JWT - valida secret)
router.post("/whatsapp/webhook/:wahaSessionId", webhookHandler);

// Configuração do lembrete de agendamento (horas antes)
router.patch(
  "/whatsapp/reminder-settings",
  requireAuth,
  requireRole("admin"),
  updateReminderSettingsHandler,
);

// Sessions
router.get("/whatsapp/:id/qr", requireAuth, requireRole("admin"), sessionQrHandler);
router.get(
  "/whatsapp/:id/status",
  requireAuth,
  requireRole("admin"),
  sessionStatusHandler,
);
router.post(
  "/whatsapp/:id/disconnect",
  requireAuth,
  requireRole("admin"),
  sessionDisconnectHandler,
);
router.post(
  "/whatsapp/:id/send",
  requireAuth,
  requireRole("admin"),
  sessionSendHandler,
);

// Chat (conversas + mensagens)
router.get(
  "/whatsapp/client-links",
  requireAuth,
  requireRole("admin"),
  clientWhatsappLinksHandler,
);
router.get(
  "/whatsapp/conversations",
  requireAuth,
  requireRole("admin"),
  listConversationsHandler,
);
router.get(
  "/whatsapp/conversations/:convId/messages",
  requireAuth,
  requireRole("admin"),
  listMessagesHandler,
);
router.post(
  "/whatsapp/conversations/:convId/send",
  requireAuth,
  requireRole("admin"),
  sendMessageHandler,
);
router.post(
  "/whatsapp/conversations/:convId/seen",
  requireAuth,
  requireRole("admin"),
  markSeenHandler,
);
router.post(
  "/whatsapp/conversations/:convId/create-client",
  requireAuth,
  requireRole("admin"),
  createClientFromConversationHandler,
);
router.patch(
  "/whatsapp/conversations/:convId/contact",
  requireAuth,
  requireRole("admin"),
  updateContactNameHandler,
);
router.get(
  "/whatsapp/conversations/:convId/bookings",
  requireAuth,
  requireRole("admin"),
  conversationBookingsHandler,
);
router.patch(
  "/whatsapp/conversations/:convId/link-client",
  requireAuth,
  requireRole("admin"),
  linkClientHandler,
);
router.post(
  "/whatsapp/conversations/:convId/react",
  requireAuth,
  requireRole("admin"),
  reactMessageHandler,
);
router.delete(
  "/whatsapp/conversations/:convId",
  requireAuth,
  requireRole("admin"),
  deleteConversationHandler,
);

// Respostas rápidas / templates de mensagem (company-scoped)
router.get(
  "/message-templates",
  requireAuth,
  requireRole("admin"),
  listTemplatesHandler,
);
router.post(
  "/message-templates",
  requireAuth,
  requireRole("admin"),
  createTemplateHandler,
);
router.patch(
  "/message-templates/:id",
  requireAuth,
  requireRole("admin"),
  updateTemplateHandler,
);
router.delete(
  "/message-templates/:id",
  requireAuth,
  requireRole("admin"),
  deleteTemplateHandler,
);

// ============================================================================
// Financial module (admin-only, company-scoped)
// ============================================================================
const fin = [requireAuth, requireRole("admin"), requireCompanyAccess] as const;

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
router.post("/ai/chat", requireAuth, requireRole("admin"), aiChatHandler);

export default router;
