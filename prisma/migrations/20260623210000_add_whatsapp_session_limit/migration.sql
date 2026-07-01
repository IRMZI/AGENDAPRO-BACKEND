-- Per-company WhatsApp connection quota (sold via plan), mirroring max_attendants.
-- Additive, non-destructive: nullable INT with default 1 (999 = unlimited).
ALTER TABLE "app_fd14ee28a1_companies"
  ADD COLUMN IF NOT EXISTS "max_whatsapp_sessions" INTEGER DEFAULT 1;
