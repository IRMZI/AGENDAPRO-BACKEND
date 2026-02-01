import { Router } from "express";
import { healthCheck } from "../controllers/healthController.js";
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
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createCompanyHandler,
  getCompanyByIdHandler,
  getCompanyByUserIdHandler,
  isCompanyActiveHandler,
  updateCompanyHandler,
  updateCompanyServicesHandler,
} from "../controllers/companyController.js";
import {
  createBookingHandler,
  getBookingsByCompanyHandler,
  getBookingsByDateRangeHandler,
  getAvailableTimeSlotsHandler,
  updateBookingStatusHandler,
  archiveBookingHandler,
} from "../controllers/bookingController.js";
import {
  createAttendantHandler,
  deleteAttendantHandler,
  getAttendantByUsernameHandler,
  getAttendantsByCompanyHandler,
  updateAttendantHandler,
} from "../controllers/attendantController.js";
import {
  createServiceHandler,
  deleteServiceHandler,
  getPlanByIdHandler,
  getPlansHandler,
  getServicesByCompanyHandler,
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

const router = Router();

router.get("/health", healthCheck);

router.post("/auth/signup", signUpHandler);
router.post("/auth/login", signInHandler);
router.post("/auth/refresh", refreshHandler);
router.post("/auth/logout", logoutHandler);
router.get("/auth/me", requireAuth, meHandler);

router.post("/emails/send", sendEmailHandler);
router.post("/availability/today", getTodayAvailabilityHandler);
router.post("/availability/suggest", suggestAttendantsHandler);
router.post("/clients/search-public", searchClientsPublicHandler);
router.post("/preonboarding/check", checkTokenHandler);
router.post("/preonboarding/use", useTokenHandler);
router.get("/preonboarding/token/:token", getPreOnboardingByTokenHandler);
router.get("/preonboarding", requireAuth, getAllPreOnboardingsHandler);
router.post("/preonboarding", createPreOnboardingHandler);
router.patch("/preonboarding/:id", requireAuth, updatePreOnboardingHandler);
router.delete("/preonboarding/:id", requireAuth, deletePreOnboardingHandler);

// Leads
router.post("/leads", createLeadHandler);
router.get("/leads", requireAuth, getLeadsHandler);

// Tenants (White-Label Products)
router.get("/tenants", getAllTenantsHandler);
router.get("/tenants/slug/:slug", getTenantBySlugHandler);
router.get("/tenants/domain/:domain", getTenantByDomainHandler);
router.get("/tenants/:id", getTenantByIdHandler);
router.post("/tenants", requireAuth, createTenantHandler);
router.put("/tenants/:id", requireAuth, updateTenantHandler);
router.delete("/tenants/:id", requireAuth, deleteTenantHandler);
router.post("/tenants/seed", seedTenantsHandler);

// Companies
router.post("/companies", requireAuth, createCompanyHandler);
router.get("/companies/user/:userId", requireAuth, getCompanyByUserIdHandler);
router.get("/companies/:companyId", getCompanyByIdHandler);
router.patch(
  "/companies/:companyId/services",
  requireAuth,
  updateCompanyServicesHandler,
);
router.patch("/companies/:companyId", requireAuth, updateCompanyHandler);
router.get(
  "/companies/user/:userId/active",
  requireAuth,
  isCompanyActiveHandler,
);

// Bookings
router.post("/bookings", createBookingHandler);
router.get(
  "/bookings/company/:companyId",
  requireAuth,
  getBookingsByCompanyHandler,
);
router.get(
  "/bookings/company/:companyId/range",
  requireAuth,
  getBookingsByDateRangeHandler,
);
router.get(
  "/bookings/company/:companyId/available-slots",
  getAvailableTimeSlotsHandler,
);
router.patch(
  "/bookings/:bookingId/status",
  requireAuth,
  updateBookingStatusHandler,
);
router.patch(
  "/bookings/:bookingId/archive",
  requireAuth,
  archiveBookingHandler,
);

// Attendants
router.get(
  "/attendants/company/:companyId",
  requireAuth,
  getAttendantsByCompanyHandler,
);
router.post("/attendants", requireAuth, createAttendantHandler);
router.patch("/attendants/:attendantId", requireAuth, updateAttendantHandler);
router.delete("/attendants/:attendantId", requireAuth, deleteAttendantHandler);
router.get("/attendants/by-username", getAttendantByUsernameHandler);

// Services and plans
router.get("/plans", getPlansHandler);
router.get("/plans/:planId", getPlanByIdHandler);
router.get(
  "/services/company/:companyId",
  requireAuth,
  getServicesByCompanyHandler,
);
router.post("/services", requireAuth, createServiceHandler);
router.patch("/services/:serviceId", requireAuth, updateServiceHandler);
router.delete("/services/:serviceId", requireAuth, deleteServiceHandler);

// Business hours and weekdays
router.get(
  "/business-hours/company/:companyId",
  requireAuth,
  getCompanyBusinessHoursHandler,
);
router.put("/business-hours", requireAuth, upsertCompanyBusinessHoursHandler);
router.get(
  "/attendants/:attendantId/weekdays",
  requireAuth,
  getAttendantWeekdaysHandler,
);
router.put("/attendant-weekdays", requireAuth, upsertAttendantWeekdayHandler);

// Attendant links/banners
router.get(
  "/attendants/:attendantId/links",
  requireAuth,
  getAttendantLinksHandler,
);
router.get("/attendants/:attendantId/link", getAttendantLinkHandler);
router.post("/attendants/links", requireAuth, createAttendantLinkHandler);
router.patch(
  "/attendants/links/:linkId",
  requireAuth,
  updateAttendantLinkHandler,
);
router.delete(
  "/attendants/links/:linkId",
  requireAuth,
  deleteAttendantLinkHandler,
);
router.put("/attendants/links", requireAuth, upsertAttendantLinkHandler);

router.get(
  "/attendants/:attendantId/banner",
  requireAuth,
  getAttendantBannerHandler,
);
router.post("/attendants/banners", requireAuth, createAttendantBannerHandler);
router.patch(
  "/attendants/banners/:bannerId",
  requireAuth,
  updateAttendantBannerHandler,
);
router.delete(
  "/attendants/banners/:bannerId",
  requireAuth,
  deleteAttendantBannerHandler,
);
router.put("/attendants/banners", requireAuth, upsertAttendantBannerHandler);

// Clients
router.get(
  "/clients/company/:companyId",
  requireAuth,
  getClientsByCompanyHandler,
);
router.post("/clients", requireAuth, createClientHandler);
router.post("/clients/upsert", requireAuth, upsertClientHandler);
router.post("/clients/upsert-public", upsertClientPublicHandler);
router.patch("/clients/:clientId", requireAuth, updateClientHandler);
router.delete("/clients/:clientId", requireAuth, deleteClientHandler);
router.get(
  "/clients/:clientId/bookings",
  requireAuth,
  getClientBookingsHandler,
);

// Service plans
router.get(
  "/service-plans/company/:companyId",
  requireAuth,
  getServicePlansByCompanyHandler,
);
router.post("/service-plans", requireAuth, createServicePlanHandler);
router.patch("/service-plans/:planId", requireAuth, updateServicePlanHandler);
router.delete("/service-plans/:planId", requireAuth, deleteServicePlanHandler);

// Subscriptions
router.get(
  "/subscriptions/client/:clientId",
  requireAuth,
  getClientSubscriptionsHandler,
);
router.get(
  "/subscriptions/company/:companyId/active",
  requireAuth,
  getActiveSubscriptionsByCompanyHandler,
);
router.post("/subscriptions", requireAuth, createClientSubscriptionHandler);
router.patch(
  "/subscriptions/:subscriptionId",
  requireAuth,
  updateClientSubscriptionHandler,
);
router.post(
  "/subscriptions/process-booking",
  requireAuth,
  processBookingCompletionHandler,
);
router.get(
  "/subscriptions/:subscriptionId/summary",
  requireAuth,
  getSubscriptionSummaryHandler,
);

// Subscription sessions
router.get(
  "/subscription-sessions/subscription/:subscriptionId",
  requireAuth,
  getSubscriptionSessionsHandler,
);
router.post(
  "/subscription-sessions",
  requireAuth,
  createSubscriptionSessionHandler,
);
router.patch(
  "/subscription-sessions/:sessionId",
  requireAuth,
  updateSubscriptionSessionHandler,
);
router.post(
  "/subscription-sessions/:sessionId/complete",
  requireAuth,
  markSessionAsCompletedHandler,
);
router.post(
  "/subscription-sessions/:sessionId/schedule",
  requireAuth,
  scheduleSessionHandler,
);
router.get(
  "/subscription-sessions/company/:companyId/with-bookings",
  requireAuth,
  getSessionsWithBookingsHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/status",
  requireAuth,
  updateSessionStatusHandler,
);
router.patch(
  "/subscription-sessions/:sessionId/archive",
  requireAuth,
  archiveSessionHandler,
);

export default router;
