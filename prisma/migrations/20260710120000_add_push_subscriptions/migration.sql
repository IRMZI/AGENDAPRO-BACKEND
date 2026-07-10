-- CreateTable
CREATE TABLE "app_fd14ee28a1_push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_push_subscriptions_endpoint_key" ON "app_fd14ee28a1_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "app_fd14ee28a1_push_subscriptions_user_id_idx" ON "app_fd14ee28a1_push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_push_subscriptions" ADD CONSTRAINT "app_fd14ee28a1_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_fd14ee28a1_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
