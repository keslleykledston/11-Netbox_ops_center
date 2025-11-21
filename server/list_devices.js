import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function listDevices() {
    const devices = await prisma.device.findMany({
        select: { id: true, name: true, ipAddress: true, snmpCommunity: true, snmpVersion: true }
    });
    console.log("Devices in database:");
    console.table(devices);
    await prisma.$disconnect();
}

listDevices().catch(console.error);
