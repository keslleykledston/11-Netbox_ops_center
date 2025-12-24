import { PrismaClient } from '@prisma/client';
import { refreshPendingNetboxDevices } from '../../netbox.js';

const prisma = new PrismaClient();

export async function processNetboxPendingRefresh(job) {
  const { url: urlOverride, token: tokenOverride, limit, defaultCredentials, tenantId } = job.data || {};
  const tenantGroupFilter = process.env.NETBOX_TENANT_GROUP_FILTER || null;
  const url = urlOverride || process.env.NETBOX_URL;
  const token = tokenOverride || process.env.NETBOX_TOKEN;

  if (!url || !token) {
    throw new Error('NETBOX_URL/NETBOX_TOKEN ausentes');
  }

  const result = await refreshPendingNetboxDevices(prisma, {
    url,
    token,
    limit: Number(limit) || 50,
    defaultCredentials: defaultCredentials || {},
    tenantGroupFilter,
  });

  return {
    success: true,
    tenantId: tenantId || null,
    ...result,
    completedAt: new Date().toISOString(),
  };
}
