import { PrismaClient } from '@prisma/client';
import { validateDeviceCredentials } from '../../modules/access/credential-validator.js';

const prisma = new PrismaClient();

export async function processCredentialCheck(job) {
  const { deviceId, netboxConfig } = job.data || {};
  if (!deviceId) throw new Error('deviceId is required');

  const config = netboxConfig || {
    url: process.env.NETBOX_URL,
    token: process.env.NETBOX_TOKEN,
  };

  await job.updateProgress(5);
  const result = await validateDeviceCredentials(prisma, Number(deviceId), config);
  await job.updateProgress(100);

  return {
    success: true,
    ...result,
    completedAt: new Date().toISOString(),
  };
}
