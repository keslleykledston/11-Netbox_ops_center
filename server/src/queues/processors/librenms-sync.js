/**
 * LibreNMS Sync Job Processor
 * Adds/updates/deletes devices in LibreNMS when they are changed in NetBox Ops Center
 */

import { PrismaClient } from '@prisma/client';
import { addDeviceToLibreNMS, updateDeviceInLibreNMS, deleteDeviceFromLibreNMS } from '../../modules/monitor/librenms-service.js';

const prisma = new PrismaClient();

export async function processLibreNmsSync(job) {
  const { action, deviceId, device: deviceData } = job.data;

  try {
    await job.updateProgress(10);
    await job.log(`Processing LibreNMS ${action} for device ${deviceId}`);

    // Get tenant name for grouping
    let tenantName = null;
    if (deviceData.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: deviceData.tenantId },
        select: { name: true },
      });
      tenantName = tenant?.name || null;
      if (tenantName) {
        await job.log(`Tenant: ${tenantName}`);
      }
    }

    let result;
    let libreNmsId = null;

    switch (action) {
      case 'add':
        // Add device to LibreNMS
        result = await addDeviceToLibreNMS(deviceData, tenantName);

        if (result.success && result.deviceId) {
          libreNmsId = result.deviceId;

          // Update device in database with LibreNMS ID
          await prisma.device.update({
            where: { id: deviceId },
            data: {
              libreNmsId: libreNmsId,
              libreNmsStatus: 'down', // Initially down until first poll
              lastLibreNmsCheck: new Date(),
            },
          });

          await job.log(`Device added to LibreNMS with ID ${libreNmsId}`);
        } else if (result.alreadyExists && result.deviceId) {
          // Device already exists, just update our database
          await prisma.device.update({
            where: { id: deviceId },
            data: { libreNmsId: result.deviceId },
          });
          await job.log(`Device already exists in LibreNMS (ID ${result.deviceId})`);
        } else {
          await job.log(`Failed to add device: ${result.error || 'Unknown error'}`);
        }
        break;

      case 'update':
        // Get device from database to get libreNmsId
        const dbDevice = await prisma.device.findUnique({
          where: { id: deviceId },
        });

        if (!dbDevice) {
          throw new Error(`Device ${deviceId} not found in database`);
        }

        if (!dbDevice.libreNmsId) {
          // Device not in LibreNMS yet, add it instead
          await job.log('Device not in LibreNMS, adding instead of updating...');
          result = await addDeviceToLibreNMS(deviceData, tenantName);

          if (result.success && result.deviceId) {
            await prisma.device.update({
              where: { id: deviceId },
              data: { libreNmsId: result.deviceId },
            });
            await job.log(`Device added to LibreNMS with ID ${result.deviceId}`);
          }
        } else {
          // Update existing device in LibreNMS
          result = await updateDeviceInLibreNMS(dbDevice.libreNmsId, deviceData, tenantName);
          await job.log(`Device updated in LibreNMS (ID ${dbDevice.libreNmsId})`);
        }
        break;

      case 'delete':
        // Get device from database to get libreNmsId
        const deviceToDelete = await prisma.device.findUnique({
          where: { id: deviceId },
        }).catch(() => null);

        if (deviceToDelete && deviceToDelete.libreNmsId) {
          result = await deleteDeviceFromLibreNMS(deviceToDelete.libreNmsId);
          await job.log(`Device removed from LibreNMS (ID ${deviceToDelete.libreNmsId})`);
        } else {
          await job.log('Device not found in LibreNMS or already deleted');
          result = { success: true, message: 'Device not in LibreNMS' };
        }
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await job.updateProgress(100);
    await job.log('LibreNMS sync completed successfully');

    return {
      success: true,
      action,
      deviceId,
      libreNmsId,
      result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[LIBRENMS-SYNC] Job failed:', error);
    await job.log(`Error: ${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
