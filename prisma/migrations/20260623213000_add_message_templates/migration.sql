-- Reusable message templates (quick replies now; booking/auto-reply later).
CREATE TABLE IF NOT EXISTS "app_fd14ee28a1_message_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'quick_reply',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shortcut" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_fd14ee28a1_message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "app_fd14ee28a1_message_templates_company_id_category_idx"
    ON "app_fd14ee28a1_message_templates" ("company_id", "category");

DO $$ BEGIN
    ALTER TABLE "app_fd14ee28a1_message_templates"
        ADD CONSTRAINT "app_fd14ee28a1_message_templates_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
