-- WhatsApp booking automations: reminder idempotency + configurable window.
ALTER TABLE "app_fd14ee28a1_companies"
  ADD COLUMN IF NOT EXISTS "reminder_hours_before" INTEGER DEFAULT 24;

ALTER TABLE "app_fd14ee28a1_bookings"
  ADD COLUMN IF NOT EXISTS "reminder_sent_at" TIMESTAMP(3);
