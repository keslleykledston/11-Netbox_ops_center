
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeDeviceByName(name) {
    if (!name) {
        console.error('Please provide a device name as an argument.');
        process.exit(1);
    }

    console.log(`Looking for device with name: ${name}`);

    try {
        const device = await prisma.device.findFirst({
            where: { name: name },
        });

        if (!device) {
            console.log(`Device '${name}' not found.`);
            return;
        }

        console.log(`Found device: ${device.name} (ID: ${device.id})`);
        console.log('Removing related data...');

        // Delete related data first (foreign key constraints)
        const deletedInterfaces = await prisma.discoveredInterface.deleteMany({
            where: { deviceId: device.id },
        });
        console.log(`Deleted ${deletedInterfaces.count} interfaces.`);

        const deletedPeers = await prisma.discoveredBgpPeer.deleteMany({
            where: { deviceId: device.id },
        });
        console.log(`Deleted ${deletedPeers.count} BGP peers.`);

        const deletedSessions = await prisma.sshSession.deleteMany({
            where: { deviceId: device.id },
        });
        console.log(`Deleted ${deletedSessions.count} SSH sessions.`);

        // Delete the device
        await prisma.device.delete({
            where: { id: device.id },
        });

        console.log(`Device '${name}' successfully removed.`);

    } catch (error) {
        console.error('Error removing device:', error);
    } finally {
        await prisma.$disconnect();
    }
}

const deviceName = process.argv[2];
removeDeviceByName(deviceName);
