/*
  Warnings:

  - A unique constraint covering the columns `[checkoutRequestId]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "checkoutRequestId" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "merchantRequestId" TEXT,
ADD COLUMN     "mpesaReceipt" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutRequestId_key" ON "Payment"("checkoutRequestId");
