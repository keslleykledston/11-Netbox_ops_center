-- CreateTable
CREATE TABLE "NetboxWebhookLog" (
    "id" SERIAL NOT NULL,
    "payload" TEXT NOT NULL,
    "tenantName" TEXT,
    "tenantNetboxId" INTEGER,
    "deviceNetboxId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetboxWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetboxWebhookLog_createdAt_idx" ON "NetboxWebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "NetboxWebhookLog_tenantName_idx" ON "NetboxWebhookLog"("tenantName");

-- CreateIndex
CREATE INDEX "NetboxWebhookLog_tenantNetboxId_idx" ON "NetboxWebhookLog"("tenantNetboxId");
