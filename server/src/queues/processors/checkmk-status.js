/**
 * CheckMK Status Polling Job Processor
 * Fetches monitoring status from CheckMK for active devices and updates database
 * Runs periodically in the background (non-blocking)
 */

import { PrismaClient } from '@prisma/client';
import { getHostsStatus, isCheckmkAvailable } from '../../modules/monitor/checkmk-service.js';

const prisma = new PrismaClient();

export async function processCheckmkStatusPoll(job) {
  try {
    // Check if CheckMK is configured
    if (!isCheckmkAvailable()) {
      await job.log('CheckMK not configured, skipping status poll');
      return {
        success: true,
        skipped: true,
        reason: 'CheckMK not configured',
      };
    }

    await job.updateProgress(10);
    await job.log('Fetching active devices from database...');

    // Get all active devices with monitoringEnabled
    const devices = await prisma.device.findMany({
      where: {
        status: 'active',
        monitoringEnabled: true,
      },
      select: {
        id: true,
        name: true,
        ipAddress: true,
      },
    });

    if (devices.length === 0) {
      await job.log('No devices with monitoring enabled found');
      return {
        success: true,
        devicesChecked: 0,
      };
    }

    await job.log(`Found ${devices.length} devices to check`);
    await job.updateProgress(20);

    // Sanitize device names for CheckMK (same logic as in checkmk-service.js)
    const deviceMap = new Map();
    const sanitizedNames = devices.map(device => {
      const sanitized = device.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
      deviceMap.set(sanitized, device);
      return sanitized;
    });

    await job.log('Fetching status from CheckMK...');
    await job.updateProgress(40);

    // Fetch status from CheckMK in batch
    const statusMap = await getHostsStatus(sanitizedNames);

    await job.log(`Received status for ${Object.keys(statusMap).length} hosts`);
    await job.updateProgress(60);

    // Update database with statuses
    let updated = 0;
    for (const [sanitizedName, statusInfo] of Object.entries(statusMap)) {
      const device = deviceMap.get(sanitizedName);
      if (!device) continue;

      try {
        await prisma.device.update({
          where: { id: device.id },
          data: {
            checkmkStatus: statusInfo.state || 'unknown',
            lastCheckmkCheck: new Date(),
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
    console.error('[CHECKMK-STATUS] Job failed:', error);
    await job.log(`Error: ${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
