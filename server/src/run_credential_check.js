import "./env.js";
import { PrismaClient } from '@prisma/client';
import { validateDeviceCredentials } from './modules/access/credential-validator.js';

const prisma = new PrismaClient();

const NETBOX_URL = process.env.NETBOX_URL || 'https://docs.k3gsolutions.com.br';
// Use the specific token provided by user or from env
const NETBOX_TOKEN = '6952ef873bbc26f8465c2eb521fde7035d76c9c1';

async function run() {
    // Find device 2647 (ID in NetBox might differ from ID in local DB if not synced with ID preservation)
    // Let's find by name "INFORR-BVA-JCL-RX" or just list devices to find the one we want.
    // In previous steps, we saw device 2647 in NetBox mapped to ID 14 in local DB?
    // Let's search by NetBox ID if possible, or name.

    // In check_db.js output: "Found device: INFORR-BVA-JCL-RX ... ID: 14"
    // But validateDeviceCredentials expects the LOCAL DB ID.

    const deviceName = "INFORR-BVA-JCL-RX";
    const device = await prisma.device.findFirst({
        where: { name: deviceName }
    });

    if (!device) {
        console.error(`Device ${deviceName} not found in local DB.`);
        return;
    }

    console.log(`Found device ${device.name} (Local ID: ${device.id})`);

    try {
        const report = await validateDeviceCredentials(prisma, device.id, {
            url: NETBOX_URL,
            token: NETBOX_TOKEN
        });

        console.log('\n=== Validation Report ===');
        console.table(report.results);

        if (report.best) {
            console.log(`\nBest working credential: ${report.best.username}`);
        } else {
            console.log('\nNo working credentials found.');
        }

    } catch (e) {
        console.error("Validation failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
