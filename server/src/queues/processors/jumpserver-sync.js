import { PrismaClient } from '@prisma/client';
import { JumpserverClient } from '../../modules/access/jumpserver-client.js';
import { buildAssetIndex, extractDeviceIp, findBestMatch } from '../../utils/device-matcher.js';

const prisma = new PrismaClient();

async function listAllJumpserverAssets(client, limit = 200) {
  const assets = [];
  let offset = 0;
  while (true) {
    const page = await client.getAssets({ limit, offset });
    if (!Array.isArray(page)) {
      break;
    }
    assets.push(...page);
    if (page.length < limit) {
      break;
    }
    offset += limit;
  }
  return assets;
}

export async function processJumpserverSync(job) {
  const { syncJobId, devices, jumpserverConfig, threshold } = job.data || {};

  if (!syncJobId || !Array.isArray(devices)) {
    throw new Error('syncJobId e devices sao obrigatorios');
  }

  const client = new JumpserverClient({
    baseUrl: jumpserverConfig?.url,
    apiToken: jumpserverConfig?.apiKey,
    organizationId: jumpserverConfig?.organizationId || null,
  });

  const assets = await listAllJumpserverAssets(client, jumpserverConfig?.batchLimit || 200);
  const fuse = buildAssetIndex(assets, { threshold });

  let createdCount = 0;
  let updatedCount = 0;
  const pendingRows = [];

  for (const device of devices) {
    const deviceId = device?.id ?? device?.deviceId;
    const deviceName = device?.name || device?.display || null;
    if (!deviceId || !deviceName) {
      continue;
    }

    const match = findBestMatch(device, assets, { fuse, threshold });
    const action = match?.found ? 'update' : 'create';
    if (action === 'create') {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }

    pendingRows.push({
      syncJobId,
      action,
      deviceId: String(deviceId),
      deviceName,
      deviceIp: extractDeviceIp(device),
      tenantName: device?.tenant?.name || 'NetBox',
      matchScore: match?.score ?? null,
      matchedAssetId: match?.found?.id ? String(match.found.id) : null,
      status: 'pending',
      netboxData: device,
      jumpserverData: match?.found || null,
    });
  }

  if (pendingRows.length) {
    await prisma.pendingAction.createMany({ data: pendingRows });
  }

  const updatedJob = await prisma.syncJob.update({
    where: { id: syncJobId },
    data: {
      processedDevices: { increment: devices.length },
      createdAssets: { increment: createdCount },
      updatedAssets: { increment: updatedCount },
    },
  });

  if (updatedJob.processedDevices >= updatedJob.totalDevices) {
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });
  }

  if (job?.updateProgress) {
    const progress = updatedJob.totalDevices
      ? Math.min(100, Math.round((updatedJob.processedDevices / updatedJob.totalDevices) * 100))
      : 100;
    await job.updateProgress(progress);
  }

  return {
    processed: devices.length,
    created: createdCount,
    updated: updatedCount,
  };
}
