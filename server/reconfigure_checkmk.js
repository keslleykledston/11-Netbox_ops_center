import { PrismaClient } from "@prisma/client";
import { addCheckmkSyncJob, closeQueues } from "./src/queues/index.js";
import "dotenv/config";

const prisma = new PrismaClient();

async function updateCheckmkHostsConfig() {
    console.log("Updating Checkmk hosts to SNMP-only (no-agent) configuration...");
    try {
        const devices = await prisma.device.findMany({
            where: { monitoringEnabled: true },
        });

        console.log(`Found ${devices.length} monitored devices.`);

        for (const device of devices) {
            console.log(`Updating ${device.name} (${device.ipAddress})...`);
            // Use 'update' action to reconfigure existing hosts
            await addCheckmkSyncJob('update', device.id, device, 'config-update');
        }

        console.log("\nAll host configuration updates enqueued.");
        console.log("After jobs complete, you should:");
        console.log("1. Go to each host in Checkmk");
        console.log("2. Run 'Full Service Scan' to discover SNMP services");
        console.log("3. Activate discovered services (interfaces, CPU, memory, BGP, etc.)");
    } catch (error) {
        console.error("Error updating hosts:", error);
    } finally {
        await prisma.$disconnect();
        setTimeout(async () => {
            await closeQueues();
            process.exit(0);
        }, 2000);
    }
}

updateCheckmkHostsConfig();
