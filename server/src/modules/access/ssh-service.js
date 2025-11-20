import crypto from 'node:crypto';
import { Client as SshClient } from 'ssh2';
import { decryptSecret } from '../../cred.js';
import { createSessionRecorder, readSessionLog } from './session-recorder.js';

function randomKey() {
  return crypto.randomBytes(24).toString('hex');
}

export async function createSshSession({ prisma, deviceId, user }) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new Error('Device not found');
  if (user?.tenantId && device.tenantId !== user.tenantId && user.role !== 'admin') {
    throw new Error('Forbidden');
  }
  if (!device.credUsername || !device.credPasswordEnc) {
    throw new Error('Credenciais de acesso ausentes neste dispositivo');
  }
  const sessionKey = randomKey();
  const session = await prisma.sshSession.create({
    data: {
      sessionKey,
      userId: user?.sub ? Number(user.sub) : null,
      tenantId: user?.tenantId || null,
      deviceId: device.id,
      deviceName: device.name,
      deviceIp: device.ipAddress,
      status: 'pending',
    },
  });
  return {
    id: session.id,
    key: sessionKey,
    device: { id: device.id, name: device.name, ipAddress: device.ipAddress },
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

export async function listSshSessions({ prisma, tenantId, limit = 50 }) {
  const take = Math.min(Number(limit) || 50, 200);
  const where = tenantId ? { tenantId } : {};
  const rows = await prisma.sshSession.findMany({
    where,
    orderBy: { id: 'desc' },
    take,
    include: {
      user: true,
    },
  });
  return rows;
}

export async function getSessionLog({ prisma, sessionId, tenantId, userId, isAdmin }) {
  const session = await prisma.sshSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Sessão não encontrada');
  if (tenantId && session.tenantId !== tenantId && !isAdmin) throw new Error('Forbidden');
  if (session.userId && session.userId !== userId && !isAdmin) throw new Error('Forbidden');
  const body = readSessionLog(session.logPath);
  const { sessionKey, ...safeSession } = session;
  return {
    session: safeSession,
    log: body || '',
  };
}

export async function handleSshWebsocket({ prisma, sessionId, sessionKey, ws, user }) {
  const session = await prisma.sshSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    ws.close(1011, 'Sessão não encontrada');
    return;
  }
  if (session.sessionKey !== sessionKey) {
    ws.close(1008, 'Sessão inválida');
    return;
  }
  if (user?.tenantId && session.tenantId && session.tenantId !== user.tenantId && user.role !== 'admin') {
    ws.close(1008, 'Sem permissão');
    return;
  }
  if (session.userId && session.userId !== Number(user?.sub || 0) && user?.role !== 'admin') {
    ws.close(1008, 'Usuário diferente');
    return;
  }
  const device = await prisma.device.findUnique({ where: { id: session.deviceId } });
  if (!device) {
    ws.close(1011, 'Dispositivo não encontrado');
    return;
  }
  if (!device.credUsername || !device.credPasswordEnc) {
    ws.close(1011, 'Credenciais faltando');
    return;
  }
  const password = decryptSecret(device.credPasswordEnc);
  if (!password) {
    ws.close(1011, 'Credencial inválida');
    return;
  }
  const recorder = createSessionRecorder(session.id);
  const ssh = new SshClient();
  let stream = null;
  let closed = false;
  const startedAt = Date.now();
  await prisma.sshSession.update({
    where: { id: session.id },
    data: {
      status: 'connecting',
      startedAt: new Date(),
      logPath: recorder.filePath,
    },
  });

  function finalize(status, reason) {
    if (closed) return;
    closed = true;
    recorder.close(status);
    const endedAt = Date.now();
    const durationMs = Math.max(0, endedAt - startedAt);
    prisma.sshSession.update({
      where: { id: session.id },
      data: {
        status,
        reason: reason || null,
        endedAt: new Date(),
        durationMs,
      },
    }).catch((err) => console.warn('[SSH][WARN] finalize update failed:', err.message));
  }

  ssh.on('ready', () => {
    prisma.sshSession.update({
      where: { id: session.id },
      data: { status: 'active' },
    }).catch(() => {});
    ssh.shell({ term: 'xterm-color' }, (err, sshStream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close(1011, err.message);
        finalize('error', err.message);
        return;
      }
      stream = sshStream;
      stream.on('data', (chunk) => {
        try {
          recorder.write('OUT', chunk);
        } catch (e) {
          console.warn('[SSH][WARN] recorder write error:', e.message);
        }
        ws.send(JSON.stringify({ type: 'data', payload: chunk.toString('utf8') }));
      });
      stream.on('close', () => {
        ws.close(1000, 'Sessão encerrada');
        finalize('closed');
      });
      stream.stderr?.on('data', (chunk) => {
        recorder.write('ERR', chunk);
        ws.send(JSON.stringify({ type: 'error', payload: chunk.toString('utf8') }));
      });
    });
  }).on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close(1011, err.message);
    finalize('error', err.message);
  }).connect({
    host: device.ipAddress,
    port: device.sshPort || 22,
    username: device.credUsername,
    password,
    readyTimeout: 15000,
  });

  ws.on('message', (raw) => {
    if (!stream) return;
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'data' && typeof msg.payload === 'string') {
        stream.write(msg.payload);
        recorder.write('IN', msg.payload);
      }
      if (msg.type === 'resize') {
        const rows = Number(msg.rows) || 24;
        const cols = Number(msg.cols) || 80;
        stream.setWindow(rows, cols, rows, cols);
      }
    } catch {
      stream.write(raw);
    }
  });

  ws.on('close', () => {
    ssh.end();
    finalize('closed', 'client-disconnected');
  });
}
