import { PrismaClient } from '@prisma/client';
import { addSnmpDiscoveryJob, addSnmpPollingJob } from '../index.js';

const prisma = new PrismaClient();

export async function processDeviceScan(job) {
  const { deviceId, userId, tenantId, reason } = job.data || {};
  if (!deviceId) throw new Error('deviceId is required');

  const device = await prisma.device.findUnique({ where: { id: Number(deviceId) } });
  if (!device) throw new Error(`Device ${deviceId} not found`);

  const enqueued = [];
  await job.updateProgress(10);

  // Ping SNMP status
  try {
    const pollJob = await addSnmpPollingJob(device.id);
    enqueued.push({ queue: 'snmp-polling', jobId: pollJob.id });
  } catch (err) {
    await job.log(`Failed to enqueue snmp-polling: ${err?.message || err}`);
  }

  // Discovery of interfaces and BGP peers
  try {
    const ifaceJob = await addSnmpDiscoveryJob(device.id, 'interfaces', userId, tenantId);
    enqueued.push({ queue: 'snmp-discovery', jobId: ifaceJob.id, type: 'interfaces' });
  } catch (err) {
    await job.log(`Failed to enqueue interfaces discovery: ${err?.message || err}`);
  }

  try {
    const peerJob = await addSnmpDiscoveryJob(device.id, 'peers', userId, tenantId);
    enqueued.push({ queue: 'snmp-discovery', jobId: peerJob.id, type: 'peers' });
  } catch (err) {
    await job.log(`Failed to enqueue peers discovery: ${err?.message || err}`);
  }

  await job.updateProgress(90);

  return {
    success: true,
    deviceId,
    tenantId: tenantId || null,
    enqueued,
    reason: reason || 'manual',
    completedAt: new Date().toISOString(),
  };
}
