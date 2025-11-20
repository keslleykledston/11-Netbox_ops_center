// Netbox Sync Job Processor
import { syncFromNetbox } from '../../netbox.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function processNetboxSync(job) {
  const { resources, url, token, deviceFilters, tenantId } = job.data;

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
      onProgress: async (progress, message) => {
        await job.updateProgress(progress);
        await job.log(message);
      },
    });

    await job.updateProgress(100);

    return {
      success: true,
      ...result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Netbox sync job failed:', error);
    throw error;
  }
}
