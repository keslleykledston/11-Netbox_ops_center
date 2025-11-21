import { PrismaClient } from "@prisma/client";
import { addCheckmkSyncJob, closeQueues } from "./src/queues/index.js";
import "dotenv/config";

const prisma = new PrismaClient();

async function updateCheckmkHosts() {
    console.log("Starting Checkmk host ADD for all monitored devices...");
    try {
        const devices = await prisma.device.findMany({
            where: { monitoringEnabled: true },
        });

        console.log(`Found ${devices.length} devices to add.`);

        for (const device of devices) {
            console.log(`Enqueuing ADD for ${device.name} (${device.ipAddress})...`);
            await addCheckmkSyncJob('add', device.id, device, 'system-sync');
        }

        console.log("All add jobs enqueued.");
    } catch (error) {
        console.error("Error adding Checkmk hosts:", error);
    } finally {
        await prisma.$disconnect();
        setTimeout(async () => {
            await closeQueues();
            process.exit(0);
        }, 2000);
    }
}

updateCheckmkHosts();
