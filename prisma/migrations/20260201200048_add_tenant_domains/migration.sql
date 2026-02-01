-- AlterTable
ALTER TABLE "app_fd14ee28a1_tenants" ADD COLUMN     "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "id" DROP DEFAULT;
