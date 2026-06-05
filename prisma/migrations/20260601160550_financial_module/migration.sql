-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'pix', 'credit', 'debit', 'other');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('booking', 'subscription', 'manual');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('open', 'paid');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "app_fd14ee28a1_booking_services" ADD COLUMN     "price_snapshot" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "app_fd14ee28a1_bookings" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "payment_method" "PaymentMethod",
ADD COLUMN     "total_amount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_financial_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "source" "TransactionSource" NOT NULL DEFAULT 'manual',
    "category" TEXT,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "PaymentMethod",
    "occurred_at" DATE NOT NULL,
    "booking_id" UUID,
    "subscription_id" UUID,
    "attendant_id" UUID,
    "cash_register_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_commissions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "attendant_id" UUID NOT NULL,
    "booking_id" UUID,
    "base_amount" DECIMAL(10,2) NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "payout_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_commission_payouts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "attendant_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'open',
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_commission_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_cash_registers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opened_by" UUID,
    "opening_float" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "closing_total" DECIMAL(10,2),
    "expected_total" DECIMAL(10,2),
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_fd14ee28a1_payment_method_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fee_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_payment_method_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_financial_transactions_booking_id_key" ON "app_fd14ee28a1_financial_transactions"("booking_id");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_financial_transactions_company_id_occurred_a_idx" ON "app_fd14ee28a1_financial_transactions"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_financial_transactions_company_id_type_idx" ON "app_fd14ee28a1_financial_transactions"("company_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_commissions_booking_id_key" ON "app_fd14ee28a1_commissions"("booking_id");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_commissions_company_id_attendant_id_status_idx" ON "app_fd14ee28a1_commissions"("company_id", "attendant_id", "status");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_commission_payouts_company_id_attendant_id_idx" ON "app_fd14ee28a1_commission_payouts"("company_id", "attendant_id");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_cash_registers_company_id_status_idx" ON "app_fd14ee28a1_cash_registers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_payment_method_configs_company_id_method_key" ON "app_fd14ee28a1_payment_method_configs"("company_id", "method");

