import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { processNetboxSync } from './processors/netbox-sync.js';
import { processSnmpDiscovery } from './processors/snmp-discovery.js';
import { processSnmpPolling } from './processors/snmp-polling.js';
import { processCheckmkSync } from './processors/checkmk-sync.js';
import { processOxidizedSync } from './processors/oxidized-sync.js';
import { processDeviceScan } from './processors/device-scan.js';
import { processCredentialCheck } from './processors/credential-check.js';
import { processConnectivityTest } from './processors/connectivity-test.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let connection = null;
let workers = [];

export function startQueueWorkers() {
  if (workers.length > 0) return workers;
  connection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  workers = [
    new Worker('netbox-sync', processNetboxSync, { connection, concurrency: 2 }),
    new Worker('oxidized-sync', processOxidizedSync, { connection }),
    new Worker('snmp-discovery', processSnmpDiscovery, { connection, concurrency: 4 }),
    new Worker('snmp-polling', processSnmpPolling, { connection, concurrency: 6 }),
    new Worker('device-scan', processDeviceScan, { connection, concurrency: 4 }),
    new Worker('credential-check', processCredentialCheck, { connection, concurrency: 2 }),
    new Worker('connectivity-test', processConnectivityTest, { connection, concurrency: 4 }),
    new Worker('checkmk-sync', processCheckmkSync, { connection }),
  ];
  workers.forEach((worker) => {
    worker.on('error', (err) => console.error(`[QUEUE][${worker.name}]`, err));
    worker.on('failed', (job, err) => console.error(`[QUEUE][${worker.name}] Job ${job?.id} failed:`, err?.message || err));
    worker.on('completed', (job) => console.log(`[QUEUE][${worker.name}] Job ${job?.id} completed`));
  });
  return workers;
}

export async function stopQueueWorkers() {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
