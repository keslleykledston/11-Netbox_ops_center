-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalDevices" INTEGER NOT NULL DEFAULT 0,
    "processedDevices" INTEGER NOT NULL DEFAULT 0,
    "createdAssets" INTEGER NOT NULL DEFAULT 0,
    "updatedAssets" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceIp" TEXT,
    "tenantName" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "matchedAssetId" TEXT,
    "status" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "netboxData" JSONB NOT NULL,
    "jumpserverData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncJob_status_startedAt_idx" ON "SyncJob"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PendingAction_syncJobId_status_idx" ON "PendingAction"("syncJobId", "status");

-- CreateIndex
CREATE INDEX "PendingAction_status_createdAt_idx" ON "PendingAction"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
