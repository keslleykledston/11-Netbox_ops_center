-- Add missing Device columns
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "site" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "serial" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "assetTag" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "isProduction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "jumpserverId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "jumpserverAssetId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "useJumpserver" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "jumpserverSystemUser" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "customData" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "monitoringEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "snmpStatus" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSnmpOk" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "sshStatus" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastSshOk" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "libreNmsId" INTEGER;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "libreNmsStatus" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "lastLibreNmsCheck" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "libreNmsUptime" INTEGER;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "oxidizedProxyId" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SshSession" (
    "id" SERIAL NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "userId" INTEGER,
    "tenantId" INTEGER,
    "deviceId" INTEGER NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceIp" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "logPath" TEXT,
    "reason" TEXT,
    "jumpserverConnectionMode" TEXT,
    "jumpserverSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OxidizedProxy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "endpoint" TEXT,
    "apiKey" TEXT NOT NULL,
    "gitRepoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSeen" TIMESTAMP(3),
    "deviceCount" INTEGER NOT NULL DEFAULT 0,
    "interval" INTEGER NOT NULL DEFAULT 1800,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OxidizedProxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OxidizedProxyLog" (
    "id" SERIAL NOT NULL,
    "proxyId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "device" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OxidizedProxyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SshSession_sessionKey_key" ON "SshSession"("sessionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OxidizedProxy_siteId_key" ON "OxidizedProxy"("siteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SshSession_tenantId_idx" ON "SshSession"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SshSession_userId_idx" ON "SshSession"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SshSession_deviceId_idx" ON "SshSession"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OxidizedProxyLog_proxyId_idx" ON "OxidizedProxyLog"("proxyId");

-- AddForeignKey
ALTER TABLE "SshSession" ADD CONSTRAINT "SshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshSession" ADD CONSTRAINT "SshSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SshSession" ADD CONSTRAINT "SshSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OxidizedProxy" ADD CONSTRAINT "OxidizedProxy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OxidizedProxyLog" ADD CONSTRAINT "OxidizedProxyLog_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "OxidizedProxy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_oxidizedProxyId_fkey" FOREIGN KEY ("oxidizedProxyId") REFERENCES "OxidizedProxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
