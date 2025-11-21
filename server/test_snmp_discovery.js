import { PrismaClient } from "@prisma/client";
import { addSnmpDiscoveryJob } from "./src/queues/index.js";
import "dotenv/config";

const prisma = new PrismaClient();

async function testDiscovery() {
    const deviceId = process.argv[2] || '6'; // Default to INFORR-BVB-JCL-RX
    const type = process.argv[3] || 'interfaces'; // interfaces or peers

    const device = await prisma.device.findUnique({ where: { id: Number(deviceId) } });
    if (!device) {
        console.error(`Device ${deviceId} not found`);
        process.exit(1);
    }

    console.log(`Testing SNMP ${type} discovery for:`, device.name, device.ipAddress);
    console.log(`SNMP Version: ${device.snmpVersion || 'N/A'}`);
    console.log(`SNMP Community: ${device.snmpCommunity || 'N/A'}`);
    console.log(`SNMP Port: ${device.snmpPort || '161'}`);

    const job = await addSnmpDiscoveryJob(deviceId, type, 'test-user', null);
    console.log(`\nJob enqueued: ${job.id}`);
    console.log('Check logs in a few seconds for results.');

    await prisma.$disconnect();
    process.exit(0);
}

testDiscovery().catch(console.error);
