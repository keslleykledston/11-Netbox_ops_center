import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { addNetboxSyncJob, addOxidizedSyncJob, addSnmpPollingJob, addLibreNmsStatusJob, closeQueues } from "./queues/index.js";

const prisma = new PrismaClient();

const SNMP_POLL_INTERVAL_MS = Number(process.env.SNMP_POLL_INTERVAL_MS || 300000); // 5 min default
const OXIDIZED_SYNC_INTERVAL_MS = Number(process.env.OXIDIZED_SYNC_INTERVAL_MS || 900000); // 15 min default
const AUTO_NETBOX_SYNC = (process.env.AUTO_NETBOX_SYNC || 'false').toLowerCase() === 'true';
const NETBOX_SYNC_INTERVAL_MS = Number(process.env.NETBOX_SYNC_INTERVAL_MS || 1800000); // 30 min default
// const CHECKMK_POLL_INTERVAL_MS = Number(process.env.CHECKMK_POLL_INTERVAL_MS || 300000); // DEPRECATED
// const AUTO_CHECKMK_POLL = (process.env.AUTO_CHECKMK_POLL || 'false').toLowerCase() === 'true';  // DEPRECATED
const LIBRENMS_POLL_INTERVAL_MS = Number(process.env.LIBRENMS_POLL_INTERVAL_MS || 300000); // 5 min default
const AUTO_LIBRENMS_POLL = (process.env.AUTO_LIBRENMS_POLL || 'true').toLowerCase() === 'true';

async function scheduleSnmpPolling() {
  const devices = await prisma.device.findMany({ where: { status: 'active' } });
  for (const device of devices) {
    try {
      await addSnmpPollingJob(device.id);
    } catch (err) {
      console.warn('[SCHEDULER][SNMP] Failed to enqueue poll for device', device.id, err?.message || err);
    }
  }
  console.log(`[SCHEDULER] Enqueued SNMP polling for ${devices.length} devices`);
}

async function scheduleOxidizedSync() {
  try {
    const job = await addOxidizedSyncJob(null, null);
    console.log('[SCHEDULER] Enqueued oxidized sync job', job.id);
  } catch (err) {
    console.warn('[SCHEDULER][OXIDIZED] Failed to enqueue sync:', err?.message || err);
  }
}

async function scheduleNetboxSync() {
  try {
    if (!process.env.NETBOX_URL || !process.env.NETBOX_TOKEN) {
      console.warn('[SCHEDULER][NETBOX] NETBOX_URL/TOKEN ausentes; não agendando sync.');
      return;
    }
    const job = await addNetboxSyncJob({
      resources: ['tenants', 'devices'],
      url: process.env.NETBOX_URL,
      token: process.env.NETBOX_TOKEN,
    }, null, null);
    console.log('[SCHEDULER] Enqueued NetBox sync job', job.id);
  } catch (err) {
    console.warn('[SCHEDULER][NETBOX] Failed to enqueue sync:', err?.message || err);
  }
}

async function scheduleLibreNmsStatusPoll() {
  try {
    const job = await addLibreNmsStatusJob();
    console.log('[SCHEDULER] Enqueued LibreNMS status poll job', job.id);
  } catch (err) {
    console.warn('[SCHEDULER][LIBRENMS] Failed to enqueue status poll:', err?.message || err);
  }
}

function interval(fn, every) {
  fn().catch((err) => console.warn('[SCHEDULER][WARN]', err?.message || err));
  return setInterval(() => fn().catch((err) => console.warn('[SCHEDULER][WARN]', err?.message || err)), every);
}

console.log('[SCHEDULER] Starting...');
const timers = [];
timers.push(interval(scheduleSnmpPolling, SNMP_POLL_INTERVAL_MS));
timers.push(interval(scheduleOxidizedSync, OXIDIZED_SYNC_INTERVAL_MS));
if (AUTO_NETBOX_SYNC) {
  timers.push(interval(scheduleNetboxSync, NETBOX_SYNC_INTERVAL_MS));
}
if (AUTO_LIBRENMS_POLL) {
  timers.push(interval(scheduleLibreNmsStatusPoll, LIBRENMS_POLL_INTERVAL_MS));
  console.log('[SCHEDULER] LibreNMS status polling enabled (every', LIBRENMS_POLL_INTERVAL_MS / 1000, 'seconds)');
}

function shutdown() {
  console.log('[SCHEDULER] Shutting down...');
  timers.forEach((t) => clearInterval(t));
  Promise.all([
    prisma.$disconnect().catch(() => { }),
    closeQueues().catch(() => { }),
  ]).finally(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
