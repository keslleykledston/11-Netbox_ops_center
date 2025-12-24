-- CreateTable
CREATE TABLE "NetboxSyncState" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "tenantId" INTEGER,
    "lastCursor" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetboxSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetboxPendingDevice" (
    "id" SERIAL NOT NULL,
    "netboxId" INTEGER NOT NULL,
    "tenantNetboxId" INTEGER,
    "tenantName" TEXT,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "missingFields" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetboxPendingDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NetboxSyncState_key_tenantId_key" ON "NetboxSyncState"("key", "tenantId");

-- CreateIndex
CREATE INDEX "NetboxSyncState_tenantId_idx" ON "NetboxSyncState"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "NetboxPendingDevice_netboxId_key" ON "NetboxPendingDevice"("netboxId");

-- CreateIndex
CREATE INDEX "NetboxPendingDevice_status_nextCheckAt_idx" ON "NetboxPendingDevice"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "NetboxPendingDevice_tenantNetboxId_idx" ON "NetboxPendingDevice"("tenantNetboxId");
