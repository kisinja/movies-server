-- AlterTable
ALTER TABLE "User" ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'KES';
