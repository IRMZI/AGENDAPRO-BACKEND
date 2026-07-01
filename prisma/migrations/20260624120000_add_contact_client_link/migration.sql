-- Vínculo manual de um contato de WhatsApp a um cliente do CRM.
ALTER TABLE "app_fd14ee28a1_wa_contacts"
  ADD COLUMN IF NOT EXISTS "client_id" UUID;

DO $$ BEGIN
  ALTER TABLE "app_fd14ee28a1_wa_contacts"
    ADD CONSTRAINT "app_fd14ee28a1_wa_contacts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "app_fd14ee28a1_clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
