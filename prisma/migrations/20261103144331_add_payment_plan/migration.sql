-- DropIndex
DROP INDEX "Payment_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "plan" VARCHAR(20) NOT NULL DEFAULT 'weekly';

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
