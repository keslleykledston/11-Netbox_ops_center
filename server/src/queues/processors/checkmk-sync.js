// Checkmk Sync Job Processor
import { addHostToCheckmk, updateHostInCheckmk, deleteHostFromCheckmk, activateChanges } from '../../modules/monitor/checkmk-service.js';

export async function processCheckmkSync(job) {
  const { action, deviceId, deviceData, userId } = job.data;

  try {
    await job.updateProgress(20);
    await job.log(`Processing Checkmk ${action} for device ${deviceId}`);

    let result;
    switch (action) {
      case 'add':
        result = await addHostToCheckmk(deviceData);
        break;
      case 'update':
        try {
          result = await updateHostInCheckmk(deviceId, deviceData);
        } catch (error) {
          // If host doesn't exist (404), try to add it
          if (error.message && error.message.includes('404')) {
            await job.log('Host not found, creating instead...');
            result = await addHostToCheckmk(deviceData);
          } else {
            throw error;
          }
        }
        break;
      case 'delete':
        result = await deleteHostFromCheckmk(deviceData?.name || deviceId);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await job.updateProgress(100);
    await job.log('Checkmk sync completed successfully');
    await activateChanges();

    return {
      success: true,
      action,
      deviceId,
      result,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Checkmk sync job failed:', error);
    await job.log(`Error: ${error.message}`);
    throw error;
  }
}
