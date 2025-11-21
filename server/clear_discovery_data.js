
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEVICE_ID = 7;

async function main() {
    console.log(`Clearing discovery data for device ${DEVICE_ID}...`);

    const deletedInterfaces = await prisma.discoveredInterface.deleteMany({
        where: { deviceId: DEVICE_ID },
    });
    console.log(`Deleted ${deletedInterfaces.count} interfaces.`);

    const deletedPeers = await prisma.discoveredBgpPeer.deleteMany({
        where: { deviceId: DEVICE_ID },
    });
    console.log(`Deleted ${deletedPeers.count} BGP peers.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
