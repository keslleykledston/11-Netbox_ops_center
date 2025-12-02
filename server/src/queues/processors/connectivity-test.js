import net from 'node:net';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function tcpCheck(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ ok: false, error: err?.message || String(err) });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

export async function processConnectivityTest(job) {
  const { deviceId, target, port, timeoutMs = 5000 } = job.data || {};
  if (!deviceId) throw new Error('deviceId is required');

  const device = await prisma.device.findUnique({ where: { id: Number(deviceId) } });
  if (!device) throw new Error(`Device ${deviceId} not found`);

  const host = target || device.ipAddress;
  const effectivePort = Number(port || device.sshPort || 22);

  await job.updateProgress(10);
  const started = Date.now();
  const res = await tcpCheck(host, effectivePort, timeoutMs);
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    await job.log(res.error || 'connectivity failed');
    throw new Error(res.error || 'connectivity failed');
  }

  await job.updateProgress(100);

  return {
    success: true,
    host,
    port: effectivePort,
    latencyMs,
    completedAt: new Date().toISOString(),
  };
}
