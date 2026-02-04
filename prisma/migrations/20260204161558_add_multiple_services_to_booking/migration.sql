-- CreateTable
CREATE TABLE "app_fd14ee28a1_booking_services" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_fd14ee28a1_booking_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_fd14ee28a1_booking_services_booking_id_service_id_key" ON "app_fd14ee28a1_booking_services"("booking_id", "service_id");

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_booking_services" ADD CONSTRAINT "app_fd14ee28a1_booking_services_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "app_fd14ee28a1_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_fd14ee28a1_booking_services" ADD CONSTRAINT "app_fd14ee28a1_booking_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "app_fd14ee28a1_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
