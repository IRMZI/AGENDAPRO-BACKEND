-- CreateTable
CREATE TABLE "app_fd14ee28a1_company_permissions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "use_google_agenda" BOOLEAN NOT NULL DEFAULT false,
    "use_financeiro" BOOLEAN NOT NULL DEFAULT true,
    "use_conversation" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_company_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_company_permissions_company_id_key" ON "app_fd14ee28a1_company_permissions"("company_id");

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_company_permissions" ADD CONSTRAINT "app_fd14ee28a1_company_permissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "app_fd14ee28a1_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

