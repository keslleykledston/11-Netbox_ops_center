/**
 * LibreNMS Status Polling Job Processor
 * Fetches monitoring status from LibreNMS for all monitored devices and updates database
 * Runs periodically in the background (non-blocking)
 */

import { PrismaClient } from '@prisma/client';
import { getBatchDeviceStatus, isLibreNMSAvailable } from '../../modules/monitor/librenms-service.js';

const prisma = new PrismaClient();

export async function processLibreNmsStatusPoll(job) {
  try {
    // Check if LibreNMS is configured
    if (!isLibreNMSAvailable()) {
      await job.log('LibreNMS not configured, skipping status poll');
      return {
        success: true,
        skipped: true,
        reason: 'LibreNMS not configured',
      };
    }

    await job.updateProgress(10);
    await job.log('Fetching monitored devices from database...');

    // Get all devices with monitoringEnabled and libreNmsId
    const devices = await prisma.device.findMany({
      where: {
        monitoringEnabled: true,
        libreNmsId: { not: null },
      },
      select: {
        id: true,
        name: true,
        libreNmsId: true,
      },
    });

    if (devices.length === 0) {
      await job.log('No devices with monitoring enabled and LibreNMS ID found');
      return {
        success: true,
        devicesChecked: 0,
      };
    }

    await job.log(`Found ${devices.length} devices to check`);
    await job.updateProgress(20);

    // Get LibreNMS IDs
    const libreNmsIds = devices.map(d => d.libreNmsId).filter(Boolean);

    await job.log('Fetching status from LibreNMS...');
    await job.updateProgress(40);

    // Fetch status from LibreNMS in batch
    const statusMap = await getBatchDeviceStatus(libreNmsIds);

    await job.log(`Received status for ${statusMap.size} devices`);
    await job.updateProgress(60);

    // Update database with statuses
    let updated = 0;
    for (const device of devices) {
      if (!device.libreNmsId) continue;

      const statusInfo = statusMap.get(device.libreNmsId);
      if (!statusInfo) continue;

      try {
        // Determine final status
        let finalStatus = 'unknown';
        if (statusInfo.disabled) {
          finalStatus = 'disabled';
        } else {
          finalStatus = statusInfo.status || 'unknown';
        }

        await prisma.device.update({
          where: { id: device.id },
          data: {
            libreNmsStatus: finalStatus,
            lastLibreNmsCheck: new Date(),
            libreNmsUptime: statusInfo.uptime || 0,
          },
        });
        updated++;
      } catch (err) {
        await job.log(`Failed to update device ${device.name}: ${err.message}`);
      }
    }

    await job.updateProgress(100);
    await job.log(`Updated ${updated}/${devices.length} devices`);

    return {
      success: true,
      devicesChecked: devices.length,
      devicesUpdated: updated,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[LIBRENMS-STATUS] Job failed:', error);
    await job.log(`Error: ${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
