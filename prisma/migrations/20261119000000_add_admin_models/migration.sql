CREATE TYPE "MessageStatus" AS ENUM ('NEW', 'RESOLVED');
CREATE TYPE "ContactTopic" AS ENUM ('support', 'billing', 'info');
CREATE TYPE "AuditTargetType" AS ENUM ('user', 'payment', 'message', 'title');
CREATE TYPE "TitleType" AS ENUM ('movie', 'tv');

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" "AuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" "ContactTopic" NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlockedTitle" (
    "id" TEXT NOT NULL,
    "type" "TitleType" NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedTitle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");
CREATE INDEX "ContactMessage_resolvedById_idx" ON "ContactMessage"("resolvedById");
CREATE UNIQUE INDEX "BlockedTitle_type_tmdbId_key" ON "BlockedTitle"("type", "tmdbId");
CREATE INDEX "BlockedTitle_createdById_idx" ON "BlockedTitle"("createdById");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_subscriptionExpiresAt_idx" ON "User"("subscriptionExpiresAt");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContactMessage"
    ADD CONSTRAINT "ContactMessage_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlockedTitle"
    ADD CONSTRAINT "BlockedTitle_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
