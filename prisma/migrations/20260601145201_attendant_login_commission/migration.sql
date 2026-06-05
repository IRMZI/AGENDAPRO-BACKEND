-- AlterTable
ALTER TABLE "app_fd14ee28a1_attendants" ADD COLUMN     "commission_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commission_percent" DECIMAL(5,2),
ADD COLUMN     "invite_expires_at" TIMESTAMP(3),
ADD COLUMN     "invite_token" TEXT,
ADD COLUMN     "login_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendants_invite_token_key" ON "app_fd14ee28a1_attendants"("invite_token");

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_attendants_user_id_key" ON "app_fd14ee28a1_attendants"("user_id");

