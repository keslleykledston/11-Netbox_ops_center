-- CreateTable
CREATE TABLE "MovideskCompany" (
    "id" SERIAL NOT NULL,
    "movideskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "status" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawData" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovideskCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetboxTenantSnapshot" (
    "id" SERIAL NOT NULL,
    "netboxId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "groupName" TEXT,
    "erpId" TEXT,
    "cnpj" TEXT,
    "description" TEXT,
    "rawData" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetboxTenantSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetboxSiteSnapshot" (
    "id" SERIAL NOT NULL,
    "netboxId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "status" TEXT,
    "tenantNetboxId" INTEGER,
    "rawData" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetboxSiteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetboxDeviceSnapshot" (
    "id" SERIAL NOT NULL,
    "netboxId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT,
    "tenantNetboxId" INTEGER,
    "siteNetboxId" INTEGER,
    "platform" TEXT,
    "serviceName" TEXT,
    "servicePort" INTEGER,
    "credUsername" TEXT,
    "credPasswordEnc" TEXT,
    "snmpCommunity" TEXT,
    "snmpPort" INTEGER,
    "rawData" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetboxDeviceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JumpserverAssetSnapshot" (
    "id" SERIAL NOT NULL,
    "jumpserverId" TEXT NOT NULL,
    "name" TEXT,
    "hostname" TEXT,
    "ipAddress" TEXT,
    "assetId" TEXT,
    "hostId" TEXT,
    "nodePath" TEXT,
    "platform" TEXT,
    "rawData" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JumpserverAssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovideskSyncAction" (
    "id" TEXT NOT NULL,
    "movideskCompanyId" INTEGER,
    "movideskId" TEXT,
    "netboxTenantId" INTEGER,
    "netboxTenantName" TEXT,
    "jumpserverNodePath" TEXT,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "systems" TEXT,
    "details" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovideskSyncAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MovideskCompany_movideskId_key" ON "MovideskCompany"("movideskId");

-- CreateIndex
CREATE UNIQUE INDEX "NetboxTenantSnapshot_netboxId_key" ON "NetboxTenantSnapshot"("netboxId");

-- CreateIndex
CREATE UNIQUE INDEX "NetboxSiteSnapshot_netboxId_key" ON "NetboxSiteSnapshot"("netboxId");

-- CreateIndex
CREATE UNIQUE INDEX "NetboxDeviceSnapshot_netboxId_key" ON "NetboxDeviceSnapshot"("netboxId");

-- CreateIndex
CREATE UNIQUE INDEX "JumpserverAssetSnapshot_jumpserverId_key" ON "JumpserverAssetSnapshot"("jumpserverId");

-- CreateIndex
CREATE INDEX "MovideskSyncAction_movideskCompanyId_idx" ON "MovideskSyncAction"("movideskCompanyId");

-- AddForeignKey
ALTER TABLE "NetboxSiteSnapshot" ADD CONSTRAINT "NetboxSiteSnapshot_tenantNetboxId_fkey" FOREIGN KEY ("tenantNetboxId") REFERENCES "NetboxTenantSnapshot"("netboxId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetboxDeviceSnapshot" ADD CONSTRAINT "NetboxDeviceSnapshot_tenantNetboxId_fkey" FOREIGN KEY ("tenantNetboxId") REFERENCES "NetboxTenantSnapshot"("netboxId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetboxDeviceSnapshot" ADD CONSTRAINT "NetboxDeviceSnapshot_siteNetboxId_fkey" FOREIGN KEY ("siteNetboxId") REFERENCES "NetboxSiteSnapshot"("netboxId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovideskSyncAction" ADD CONSTRAINT "MovideskSyncAction_movideskCompanyId_fkey" FOREIGN KEY ("movideskCompanyId") REFERENCES "MovideskCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
