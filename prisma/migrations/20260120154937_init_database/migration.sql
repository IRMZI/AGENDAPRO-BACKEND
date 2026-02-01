-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('MEI', 'SMALL', 'MID');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'attendant', 'customer');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('sessions', 'recurring');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'completed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'refunded');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "PreOnboardingStatus" AS ENUM ('pending', 'completed');

-- CreateTable
CREATE TABLE "app_fd14ee28a1_companies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "background_image_url" TEXT,
    "banner_image_url" TEXT,
    "company_token" TEXT,
    "company_nickname" TEXT,
    "company_size" "CompanySize",
    "business_model" TEXT,
    "max_attendants" INTEGER DEFAULT 1,
    "features" JSONB,
    "primary_phone" TEXT,
    "first_login_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_attendants" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "username" TEXT NOT NULL,
    "user_id" UUID,

    CONSTRAINT "app_fd14ee28a1_attendants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_bookings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "attendant_id" UUID,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_email" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "booking_date" DATE NOT NULL,
    "booking_time" TEXT NOT NULL,
    "date_time" TIMESTAMP(3),
    "status" "BookingStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service_id" UUID,
    "client_id" UUID,
    "subscription_id" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "app_fd14ee28a1_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_services" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "price" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_company_business_hours" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "open_time" TEXT,
    "close_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_company_business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_attendant_weekdays" (
    "id" UUID NOT NULL,
    "attendant_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_attendant_weekdays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_attendant_links" (
    "id" UUID NOT NULL,
    "attendant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_attendant_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_attendant_banners" (
    "id" UUID NOT NULL,
    "attendant_id" UUID NOT NULL,
    "image_url" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_attendant_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "full_name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_clients" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_plans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "plan_type" "PlanType" NOT NULL,
    "total_sessions" INTEGER,
    "recurrence_type" "RecurrenceType",
    "recurrence_interval" INTEGER DEFAULT 1,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_client_subscriptions" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sessions_remaining" INTEGER,
    "sessions_used" INTEGER NOT NULL DEFAULT 0,
    "next_booking_date" DATE,
    "last_booking_date" DATE,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "amount_paid" DECIMAL(10,2),
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "expired_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_client_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_subscription_sessions" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "booking_id" UUID,
    "company_id" UUID NOT NULL,
    "session_number" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
    "scheduled_date" DATE,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_time" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "attendant_id" UUID,

    CONSTRAINT "app_fd14ee28a1_subscription_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_preonboarding" (
    "id" UUID NOT NULL,
    "company_token" TEXT NOT NULL,
    "company_nickname" TEXT NOT NULL,
    "company_size" "CompanySize" NOT NULL,
    "business_model" TEXT NOT NULL,
    "max_attendants" INTEGER NOT NULL DEFAULT 1,
    "primary_phone" TEXT NOT NULL,
    "features" JSONB,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMP(3),
    "used_by_user_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "features_de_interesse" TEXT,
    "status" "PreOnboardingStatus" NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "app_fd14ee28a1_preonboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_plan_overrides" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "max_attendants" INTEGER,
    "max_services" INTEGER,
    "max_links" INTEGER,
    "max_banners" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_plan_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "custom_business_type" TEXT,
    "attendants_count" INTEGER,
    "source_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_companies_user_id_key" ON "app_fd14ee28a1_companies"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_companies_company_token_key" ON "app_fd14ee28a1_companies"("company_token");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendants_company_id_username_key" ON "app_fd14ee28a1_attendants"("company_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_company_business_hours_company_id_weekday_key" ON "app_fd14ee28a1_company_business_hours"("company_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendant_weekdays_attendant_id_weekday_key" ON "app_fd14ee28a1_attendant_weekdays"("attendant_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendant_links_attendant_id_key" ON "app_fd14ee28a1_attendant_links"("attendant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendant_banners_attendant_id_key" ON "app_fd14ee28a1_attendant_banners"("attendant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_user_profiles_user_id_company_id_key" ON "app_fd14ee28a1_user_profiles"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_clients_company_id_phone_key" ON "app_fd14ee28a1_clients"("company_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_subscription_sessions_subscription_id_sessio_key" ON "app_fd14ee28a1_subscription_sessions"("subscription_id", "session_number");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_preonboarding_company_token_key" ON "app_fd14ee28a1_preonboarding"("company_token");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_plan_overrides_company_id_key" ON "app_fd14ee28a1_plan_overrides"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_users_email_key" ON "app_fd14ee28a1_users"("email");

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_companies" ADD CONSTRAINT "app_fd14ee28a1_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_attendants" ADD CONSTRAINT "app_fd14ee28a1_attendants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_attendants" ADD CONSTRAINT "app_fd14ee28a1_attendants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_bookings" ADD CONSTRAINT "app_fd14ee28a1_bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_bookings" ADD CONSTRAINT "app_fd14ee28a1_bookings_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_bookings" ADD CONSTRAINT "app_fd14ee28a1_bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "app_fd14ee28a1_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_bookings" ADD CONSTRAINT "app_fd14ee28a1_bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "app_fd14ee28a1_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_bookings" ADD CONSTRAINT "app_fd14ee28a1_bookings_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "app_fd14ee28a1_client_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_services" ADD CONSTRAINT "app_fd14ee28a1_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_company_business_hours" ADD CONSTRAINT "app_fd14ee28a1_company_business_hours_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_attendant_weekdays" ADD CONSTRAINT "app_fd14ee28a1_attendant_weekdays_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_attendant_links" ADD CONSTRAINT "app_fd14ee28a1_attendant_links_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_attendant_banners" ADD CONSTRAINT "app_fd14ee28a1_attendant_banners_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_user_profiles" ADD CONSTRAINT "app_fd14ee28a1_user_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_user_profiles" ADD CONSTRAINT "app_fd14ee28a1_user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_clients" ADD CONSTRAINT "app_fd14ee28a1_clients_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_plans" ADD CONSTRAINT "app_fd14ee28a1_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_plans" ADD CONSTRAINT "app_fd14ee28a1_plans_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "app_fd14ee28a1_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_client_subscriptions" ADD CONSTRAINT "app_fd14ee28a1_client_subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "app_fd14ee28a1_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_client_subscriptions" ADD CONSTRAINT "app_fd14ee28a1_client_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "app_fd14ee28a1_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_client_subscriptions" ADD CONSTRAINT "app_fd14ee28a1_client_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_subscription_sessions" ADD CONSTRAINT "app_fd14ee28a1_subscription_sessions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "app_fd14ee28a1_client_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_subscription_sessions" ADD CONSTRAINT "app_fd14ee28a1_subscription_sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "app_fd14ee28a1_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_subscription_sessions" ADD CONSTRAINT "app_fd14ee28a1_subscription_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_subscription_sessions" ADD CONSTRAINT "app_fd14ee28a1_subscription_sessions_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_preonboarding" ADD CONSTRAINT "app_fd14ee28a1_preonboarding_used_by_user_id_fkey" FOREIGN KEY ("used_by_user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_plan_overrides" ADD CONSTRAINT "app_fd14ee28a1_plan_overrides_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_auth_sessions" ADD CONSTRAINT "app_fd14ee28a1_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
