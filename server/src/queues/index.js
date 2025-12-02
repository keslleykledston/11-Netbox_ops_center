// Queue Infrastructure
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { initQueueEvents, closeQueueEvents as closeQueueEventBridge } from './events.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const QUEUE_NAMES = [
  'netbox-sync',
  'oxidized-sync',
  'snmp-discovery',
  'snmp-polling',
  'device-scan',
  'credential-check',
  'connectivity-test',
  'ssh-session',
  'checkmk-sync',
];

// Create Redis connection shared by queues
export const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err) => console.error('[REDIS] Connection error:', err));
connection.on('connect', () => console.log('[REDIS] Connected to', REDIS_URL));
connection.on('ready', () => console.log('[REDIS] Ready'));
connection.on('close', () => console.warn('[REDIS] Connection closed'));
connection.on('reconnecting', () => console.log('[REDIS] Reconnecting...'));

// Job options defaults
export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    age: 3600, // 1 hour
    count: 200,
  },
  removeOnFail: {
    age: 86400, // 24 hours
    count: 1000,
  },
};

const queueFactory = (name, options = {}) => new Queue(name, {
  connection,
  defaultJobOptions,
  ...options,
});

// Define queues
export const netboxSyncQueue = queueFactory('netbox-sync');
export const oxidizedSyncQueue = queueFactory('oxidized-sync');
export const snmpDiscoveryQueue = queueFactory('snmp-discovery');
export const snmpPollingQueue = queueFactory('snmp-polling', { defaultJobOptions: { ...defaultJobOptions, attempts: 1 } });
export const deviceScanQueue = queueFactory('device-scan');
export const credentialCheckQueue = queueFactory('credential-check', { defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });
export const connectivityTestQueue = queueFactory('connectivity-test', { defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });
export const sshSessionQueue = queueFactory('ssh-session');
export const checkmkSyncQueue = queueFactory('checkmk-sync');

const queueMap = new Map([
  ['netbox-sync', netboxSyncQueue],
  ['oxidized-sync', oxidizedSyncQueue],
  ['snmp-discovery', snmpDiscoveryQueue],
  ['snmp-polling', snmpPollingQueue],
  ['device-scan', deviceScanQueue],
  ['credential-check', credentialCheckQueue],
  ['connectivity-test', connectivityTestQueue],
  ['ssh-session', sshSessionQueue],
  ['checkmk-sync', checkmkSyncQueue],
]);

initQueueEvents(QUEUE_NAMES).catch((err) => {
  console.warn('[QUEUE-EVENTS] Failed to initialize queue events:', err?.message || err);
});

function getQueue(queueName) {
  const queue = queueMap.get(queueName);
  if (!queue) throw new Error(`Unknown queue: ${queueName}`);
  return queue;
}

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
  const jobId = tenantId ? `netbox-sync:${tenantId}:${Date.now()}` : `netbox-sync:${Date.now()}`;
  return await netboxSyncQueue.add('sync', payload, {
    ...defaultJobOptions,
    jobId,
  });
}

export async function addOxidizedSyncJob(tenantId = null, userId = null) {
  const payload = {
    tenantId,
    userId,
    startedAt: new Date().toISOString(),
  };
  const jobId = tenantId ? `oxidized-sync:${tenantId}:${Date.now()}` : `oxidized-sync:${Date.now()}`;
  return await oxidizedSyncQueue.add('sync', payload, {
    ...defaultJobOptions,
    jobId,
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

export async function addSnmpPollingJob(deviceId) {
  return await snmpPollingQueue.add('poll', {
    deviceId,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    attempts: 1, // Don't retry too much for polling
    jobId: `snmp-poll-${deviceId}-${Date.now()}`,
  });
}

export async function addDeviceScanJob(deviceId, userId, tenantId, reason = 'manual') {
  return await deviceScanQueue.add('scan', {
    deviceId,
    userId,
    tenantId,
    reason,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    jobId: `device-scan:${deviceId}:${Date.now()}`,
    removeOnComplete: { age: 600, count: 200 },
  });
}

export async function addCredentialCheckJob(deviceId, userId, tenantId, netboxConfig = null) {
  return await credentialCheckQueue.add('validate', {
    deviceId,
    userId,
    tenantId,
    netboxConfig,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    jobId: `credential-check:${deviceId}:${Date.now()}`,
    removeOnComplete: { age: 1800, count: 200 },
  });
}

export async function addConnectivityTestJob(deviceId, target = null, port = null, userId = null, tenantId = null) {
  const jobTarget = target || deviceId;
  return await connectivityTestQueue.add('test', {
    deviceId,
    target,
    port,
    userId,
    tenantId,
    startedAt: new Date().toISOString(),
  }, {
    ...defaultJobOptions,
    attempts: 2,
    jobId: `connectivity:${jobTarget}:${port || ''}:${Date.now()}`,
    removeOnComplete: { age: 900, count: 200 },
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
  const queue = getQueue(queueName);
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
  const queue = getQueue(queueName);
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
    oxidizedSyncQueue.close(),
    snmpDiscoveryQueue.close(),
    snmpPollingQueue.close(),
    deviceScanQueue.close(),
    credentialCheckQueue.close(),
    connectivityTestQueue.close(),
    sshSessionQueue.close(),
    checkmkSyncQueue.close(),
  ]);
  await closeQueueEventBridge();
  await connection.quit();
}
