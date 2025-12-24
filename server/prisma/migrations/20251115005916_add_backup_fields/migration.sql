-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tenantGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "ipAddress" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'router',
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "osVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "location" TEXT,
    "description" TEXT,
    "snmpVersion" TEXT,
    "snmpCommunity" TEXT,
    "snmpPort" INTEGER,
    "sshPort" INTEGER,
    "credUsername" TEXT,
    "credPasswordEnc" TEXT,
    "credUpdatedAt" TIMESTAMP(3),
    "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsnRegistry" (
    "id" SERIAL NOT NULL,
    "asn" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "AsnRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userRole" TEXT,
    "tenantId" INTEGER,
    "action" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredInterface" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ifIndex" TEXT NOT NULL,
    "ifName" TEXT NOT NULL,
    "ifDesc" TEXT,
    "ifType" INTEGER NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredInterface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredBgpPeer" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "deviceName" TEXT NOT NULL,
    "ipPeer" TEXT NOT NULL,
    "asn" INTEGER NOT NULL,
    "asnName" TEXT,
    "localAsn" INTEGER,
    "name" TEXT,
    "vrfName" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredBgpPeer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_name_key" ON "Tenant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AsnRegistry_asn_key" ON "AsnRegistry"("asn");

-- CreateIndex
CREATE INDEX "DiscoveredInterface_deviceId_idx" ON "DiscoveredInterface"("deviceId");

-- CreateIndex
CREATE INDEX "DiscoveredBgpPeer_deviceId_idx" ON "DiscoveredBgpPeer"("deviceId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredInterface" ADD CONSTRAINT "DiscoveredInterface_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredInterface" ADD CONSTRAINT "DiscoveredInterface_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredBgpPeer" ADD CONSTRAINT "DiscoveredBgpPeer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredBgpPeer" ADD CONSTRAINT "DiscoveredBgpPeer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
