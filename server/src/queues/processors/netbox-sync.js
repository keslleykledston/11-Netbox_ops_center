import { syncFromNetbox } from '../../netbox.js';
import { PrismaClient } from '@prisma/client';
import { syncRouterDb } from '../../modules/monitor/oxidized-service.js';

const prisma = new PrismaClient();

export async function processNetboxSync(job) {
  const { resources, url, token, deviceFilters, tenantId, defaultCredentials, fullSync } = job.data;

  try {
    // Update progress
    await job.updateProgress(10);

    // Perform sync
    const result = await syncFromNetbox(prisma, {
      resources,
      url,
      token,
      tenantScopeId: tenantId || null,
      deviceFilters,
      defaultCredentials,
      fullSync: Boolean(fullSync),
      onProgress: async (progress, message) => {
        await job.updateProgress(progress);
        await job.log(message);
      },
    });

    // Trigger Oxidized Sync for devices with backupEnabled
    if (result.devices > 0) {
      await job.log('Syncing Oxidized router.db...');
      const devices = await prisma.device.findMany({
        where: { backupEnabled: true },
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
      try {
        const oxResult = await syncRouterDb(devices);
        if (oxResult.success) {
          await job.log(`Oxidized sync success: ${devices.length} devices`);
        } else {
          await job.log(`Oxidized sync failed: ${oxResult.message}`);
        }
      } catch (oxErr) {
        await job.log(`Oxidized sync error: ${oxErr.message || oxErr}`);
      }
    }

    await job.updateProgress(100);

    return {
      success: true,
      ...result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Netbox sync job failed:', error);
    try {
      await prisma.netboxSyncState.upsert({
        where: { key_tenantId: { key: 'devices', tenantId: tenantId || null } },
        update: {
          lastRunAt: new Date(),
          lastError: String(error?.message || error),
        },
        create: {
          key: 'devices',
          tenantId: tenantId || null,
          lastRunAt: new Date(),
          lastError: String(error?.message || error),
        },
      });
    } catch (stateErr) {
      console.warn('[NetBox][WARN] Failed to update sync state after error:', stateErr?.message || stateErr);
    }
    throw error;
  }
}
