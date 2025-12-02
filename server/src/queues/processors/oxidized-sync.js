import { PrismaClient } from '@prisma/client';
import { syncRouterDb } from '../../modules/monitor/oxidized-service.js';

const prisma = new PrismaClient();

export async function processOxidizedSync(job) {
  const { tenantId } = job.data || {};
  await job.updateProgress(5);

  const where = { backupEnabled: true };
  if (tenantId) where.tenantId = Number(tenantId);

  const devices = await prisma.device.findMany({
    where,
    select: {
      id: true,
      name: true,
      ipAddress: true,
      model: true,
      manufacturer: true,
      credUsername: true,
      credPasswordEnc: true,
      sshPort: true,
      backupEnabled: true,
    },
  });

  await job.updateProgress(25);
  const result = await syncRouterDb(devices);
  await job.updateProgress(100);

  return {
    ...result,
    count: devices.length,
    tenantId: tenantId || null,
    completedAt: new Date().toISOString(),
  };
}
