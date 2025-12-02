import { QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import WebSocket from 'ws';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const subscribers = new Map(); // ws -> { queues: Set<string>, jobId?: string }
const queueEventsMap = new Map();
let eventsConnection = null;

function ensureEventsConnection() {
  if (eventsConnection) return eventsConnection;
  eventsConnection = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  eventsConnection.on('error', (err) => console.warn('[QUEUE-EVENTS] Redis error:', err?.message || err));
  eventsConnection.on('connect', () => console.log('[QUEUE-EVENTS] Connected to', REDIS_URL));
  return eventsConnection;
}

export function subscribeJobEvents(ws, { queues = [], jobId = null } = {}) {
  const set = new Set((queues || []).map((q) => String(q).trim()).filter(Boolean));
  const payload = { queues: set, jobId: jobId ? String(jobId) : null };
  subscribers.set(ws, payload);
  return payload;
}

export function unsubscribeJobEvents(ws) {
  subscribers.delete(ws);
}

export function publishQueueEvent(event) {
  const payload = JSON.stringify({ ...event, ts: event.ts || Date.now() });
  for (const [ws, filter] of subscribers.entries()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      subscribers.delete(ws);
      continue;
    }
    if (filter.jobId && String(event.jobId) !== filter.jobId) continue;
    if (filter.queues && filter.queues.size > 0 && !filter.queues.has(event.queue)) continue;
    try {
      ws.send(payload);
    } catch (err) {
      console.warn('[QUEUE-EVENTS] Failed to push to client:', err?.message || err);
    }
  }
}

function wireQueueEvents(queueName) {
  if (queueEventsMap.has(queueName)) return queueEventsMap.get(queueName);
  const connection = ensureEventsConnection();
  const qe = new QueueEvents(queueName, { connection });

  qe.on('progress', ({ jobId, data }) => publishQueueEvent({ queue: queueName, event: 'progress', jobId, progress: data }));
  qe.on('waiting', ({ jobId }) => publishQueueEvent({ queue: queueName, event: 'waiting', jobId }));
  qe.on('active', ({ jobId }) => publishQueueEvent({ queue: queueName, event: 'active', jobId }));
  qe.on('completed', ({ jobId, returnvalue }) => publishQueueEvent({ queue: queueName, event: 'completed', jobId, result: returnvalue }));
  qe.on('failed', ({ jobId, failedReason }) => publishQueueEvent({ queue: queueName, event: 'failed', jobId, failedReason }));
  qe.on('stalled', ({ jobId }) => publishQueueEvent({ queue: queueName, event: 'stalled', jobId }));
  qe.on('error', (err) => console.warn(`[QUEUE-EVENTS][${queueName}]`, err?.message || err));

  queueEventsMap.set(queueName, qe);
  return qe;
}

export async function initQueueEvents(queueNames = []) {
  queueNames.forEach((name) => {
    try {
      wireQueueEvents(name);
    } catch (err) {
      console.warn(`[QUEUE-EVENTS][WARN] Failed to init events for ${name}:`, err?.message || err);
    }
  });
}

export async function closeQueueEvents() {
  for (const qe of queueEventsMap.values()) {
    try {
      await qe.close();
    } catch { }
  }
  queueEventsMap.clear();
  if (eventsConnection) {
    try {
      await eventsConnection.quit();
    } catch { }
    eventsConnection = null;
  }
}
