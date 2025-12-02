/**
 * Prometheus Metrics Module
 * Exposes application metrics for monitoring and observability
 */

import client from 'prom-client';

// Create a Registry
export const register = new client.Registry();

// Add default metrics (process CPU, memory, event loop, etc)
client.collectDefaultMetrics({ register });

// === Custom Gauges ===

// Queue metrics
export const queueJobsWaiting = new client.Gauge({
  name: 'bullmq_jobs_waiting_total',
  help: 'Number of jobs waiting in queue',
  labelNames: ['queue'],
  registers: [register],
});

export const queueJobsActive = new client.Gauge({
  name: 'bullmq_jobs_active_total',
  help: 'Number of jobs currently active',
  labelNames: ['queue'],
  registers: [register],
});

export const queueJobsCompleted = new client.Gauge({
  name: 'bullmq_jobs_completed_total',
  help: 'Number of completed jobs',
  labelNames: ['queue'],
  registers: [register],
});

export const queueJobsFailed = new client.Gauge({
  name: 'bullmq_jobs_failed_total',
  help: 'Number of failed jobs',
  labelNames: ['queue'],
  registers: [register],
});

export const queueJobsDelayed = new client.Gauge({
  name: 'bullmq_jobs_delayed_total',
  help: 'Number of delayed jobs',
  labelNames: ['queue'],
  registers: [register],
});

// Application metrics
export const devicesTotal = new client.Gauge({
  name: 'netbox_ops_devices_total',
  help: 'Total number of devices',
  labelNames: ['status', 'tenant'],
  registers: [register],
});

export const tenantsTotal = new client.Gauge({
  name: 'netbox_ops_tenants_total',
  help: 'Total number of tenants',
  registers: [register],
});

export const sshSessionsActive = new client.Gauge({
  name: 'netbox_ops_ssh_sessions_active',
  help: 'Number of active SSH sessions',
  registers: [register],
});

// === Counters ===

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const jobExecutionsTotal = new client.Counter({
  name: 'bullmq_job_executions_total',
  help: 'Total job executions',
  labelNames: ['queue', 'status'],
  registers: [register],
});

// === Histograms ===

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const jobDuration = new client.Histogram({
  name: 'bullmq_job_duration_seconds',
  help: 'Job execution duration in seconds',
  labelNames: ['queue'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// === Helper Functions ===

/**
 * Update queue metrics for all queues
 * @param {Map<string, Queue>} queueMap - Map of queue names to Queue instances
 */
export async function updateQueueMetrics(queueMap) {
  for (const [queueName, queue] of queueMap) {
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      queueJobsWaiting.set({ queue: queueName }, counts.waiting || 0);
      queueJobsActive.set({ queue: queueName }, counts.active || 0);
      queueJobsCompleted.set({ queue: queueName }, counts.completed || 0);
      queueJobsFailed.set({ queue: queueName }, counts.failed || 0);
      queueJobsDelayed.set({ queue: queueName }, counts.delayed || 0);
    } catch (err) {
      console.warn(`[METRICS] Failed to update queue metrics for ${queueName}:`, err.message);
    }
  }
}

/**
 * Update application-specific metrics
 * @param {PrismaClient} prisma - Prisma client instance
 */
export async function updateApplicationMetrics(prisma) {
  try {
    // Count devices by status
    const devicesByStatus = await prisma.device.groupBy({
      by: ['status'],
      _count: true,
    });

    for (const group of devicesByStatus) {
      devicesTotal.set({ status: group.status, tenant: 'all' }, group._count);
    }

    // Count tenants
    const tenantsCount = await prisma.tenant.count();
    tenantsTotal.set(tenantsCount);

    // Count active SSH sessions
    const activeSessions = await prisma.sshSession.count({
      where: {
        status: { in: ['active', 'pending'] },
      },
    });
    sshSessionsActive.set(activeSessions);
  } catch (err) {
    console.warn('[METRICS] Failed to update application metrics:', err.message);
  }
}

/**
 * Express middleware to track HTTP metrics
 */
export function httpMetricsMiddleware(req, res, next) {
  const start = Date.now();

  // Capture response to record metrics
  const originalSend = res.send;
  res.send = function (data) {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path || 'unknown';
    const method = req.method;
    const statusCode = res.statusCode;

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);

    return originalSend.call(this, data);
  };

  next();
}

/**
 * Initialize periodic metrics collection
 * @param {Object} options
 * @param {Map} options.queueMap - Map of queue instances
 * @param {PrismaClient} options.prisma - Prisma client
 * @param {number} options.interval - Update interval in ms (default: 15000)
 */
export function startMetricsCollection({ queueMap, prisma, interval = 15000 }) {
  const timer = setInterval(async () => {
    await updateQueueMetrics(queueMap);
    await updateApplicationMetrics(prisma);
  }, interval);

  return () => clearInterval(timer);
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics() {
  return register.metrics();
}

export default {
  register,
  getMetrics,
  httpMetricsMiddleware,
  startMetricsCollection,
  updateQueueMetrics,
  updateApplicationMetrics,
};
