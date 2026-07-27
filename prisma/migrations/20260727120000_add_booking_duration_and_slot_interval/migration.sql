-- Per-appointment real duration. NULL = fall back to the service's duration.
-- Lets a professional override when a client takes more/less than the service default.
-- AlterTable
ALTER TABLE "app_fd14ee28a1_bookings" ADD COLUMN "duration_minutes" INTEGER;

-- Company-level granularity (minutes) of the suggested time grid in the agenda.
-- The professional can still type any custom time manually.
-- AlterTable
ALTER TABLE "app_fd14ee28a1_companies" ADD COLUMN "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30;
