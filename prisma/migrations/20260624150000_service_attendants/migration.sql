-- Vínculo M2M serviço ↔ atendente + regra de exibição de serviços sem vínculo.
CREATE TABLE "app_fd14ee28a1_service_attendants" (
  "service_id" UUID NOT NULL,
  "attendant_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_fd14ee28a1_service_attendants_pkey" PRIMARY KEY ("service_id", "attendant_id")
);

CREATE INDEX "app_fd14ee28a1_service_attendants_attendant_id_idx"
  ON "app_fd14ee28a1_service_attendants" ("attendant_id");

ALTER TABLE "app_fd14ee28a1_service_attendants"
  ADD CONSTRAINT "app_fd14ee28a1_service_attendants_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "app_fd14ee28a1_services"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_fd14ee28a1_service_attendants"
  ADD CONSTRAINT "app_fd14ee28a1_service_attendants_attendant_id_fkey"
  FOREIGN KEY ("attendant_id") REFERENCES "app_fd14ee28a1_attendants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_fd14ee28a1_companies"
  ADD COLUMN "show_unassigned_services" BOOLEAN NOT NULL DEFAULT true;
