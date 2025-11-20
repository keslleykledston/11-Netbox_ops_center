// Queue Infrastructure
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis connection
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Define queues
export const netboxSyncQueue = new Queue('netbox-sync', { connection });
export const snmpDiscoveryQueue = new Queue('snmp-discovery', { connection });
export const sshSessionQueue = new Queue('ssh-session', { connection });
export const checkmkSyncQueue = new Queue('checkmk-sync', { connection });

// Job options defaults
export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 100,
  },
  removeOnFail: {
    age: 86400, // 24 hours
    count: 1000,
  },
};

// Helper function to add jobs
export async function addNetboxSyncJob(options, userId, tenantId) {
  const payload = {
    resources: options?.resources || ['tenants', 'devices'],
    url: options?.url || null,
    token: options?.token || null,
    deviceFilters: options?.deviceFilters || null,
    userId,
    tenantId,
    startedAt: new Date().toISOString(),
  };
  return await netboxSyncQueue.add('sync', payload, {
    ...defaultJobOptions,
    jobId: `netbox-sync-${Date.now()}`,
  });
}

export async function addSnmpDiscoveryJob(deviceId, discoveryType, userId, tenantId) {
  return await snmpDiscoveryQueue.add('discover', {
    deviceId,
    discoveryType, // 'interfaces' or 'peers'
    userId,
    tenantId,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    jobId: `snmp-${discoveryType}-${deviceId}-${Date.now()}`,
  });
}

export async function addCheckmkSyncJob(action, deviceId, deviceData, userId) {
  return await checkmkSyncQueue.add('sync', {
    action, // 'add', 'update', 'delete'
    deviceId,
    deviceData,
    userId,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    jobId: `checkmk-${action}-${deviceId}-${Date.now()}`,
  });
}

// Get job status
export async function getJobStatus(queueName, jobId) {
  let queue;
  switch (queueName) {
    case 'netbox-sync':
      queue = netboxSyncQueue;
      break;
    case 'snmp-discovery':
      queue = snmpDiscoveryQueue;
      break;
    case 'ssh-session':
      queue = sshSessionQueue;
      break;
    case 'checkmk-sync':
      queue = checkmkSyncQueue;
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }

  const job = await queue.getJob(jobId);
  if (!job) return null;

  return {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    returnValue: job.returnvalue,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    timestamp: job.timestamp,
    failedReason: job.failedReason,
    state: await job.getState(),
  };
}

// Get all jobs for a queue
export async function getQueueJobs(queueName, status = 'active', start = 0, end = 10) {
  let queue;
  switch (queueName) {
    case 'netbox-sync':
      queue = netboxSyncQueue;
      break;
    case 'snmp-discovery':
      queue = snmpDiscoveryQueue;
      break;
    case 'ssh-session':
      queue = sshSessionQueue;
      break;
    case 'checkmk-sync':
      queue = checkmkSyncQueue;
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }

  const jobs = await queue.getJobs([status], start, end);

  return Promise.all(jobs.map(async (job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    returnValue: job.returnvalue,
    attemptsMade: job.attemptsMade,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    timestamp: job.timestamp,
    failedReason: job.failedReason,
    state: await job.getState(),
  })));
}

// Graceful shutdown
export async function closeQueues() {
  await Promise.all([
    netboxSyncQueue.close(),
    snmpDiscoveryQueue.close(),
    sshSessionQueue.close(),
    checkmkSyncQueue.close(),
    connection.quit(),
  ]);
}
