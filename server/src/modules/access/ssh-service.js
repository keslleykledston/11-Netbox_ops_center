import crypto from 'node:crypto';
import { Client as SshClient } from 'ssh2';
import WebSocket from 'ws';
import { decryptSecret } from '../../cred.js';
import { createSessionRecorder, readSessionLog } from './session-recorder.js';
import { createJumpserverClientFromConfig } from './jumpserver-client.js';

function randomKey() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Get Jumpserver configuration for a tenant
 */
async function getJumpserverConfig(prisma, tenantId) {
  const config = await prisma.application.findFirst({
    where: {
      tenantId,
      name: 'Jumpserver',
      status: 'connected',
    },
  });
  return config;
}

/**
 * Determine connection mode for a device
 * Returns: 'jumpserver' or 'direct'
 */
async function getConnectionMode(device, prisma) {
  // Check if device explicitly requires Jumpserver
  if (device.useJumpserver && device.jumpserverAssetId) {
    return 'jumpserver';
  }

  // Check if there's a Jumpserver configuration active for this tenant
  const jumpserverConfig = await getJumpserverConfig(prisma, device.tenantId);
  if (jumpserverConfig && device.jumpserverAssetId) {
    return 'jumpserver';
  }

  // Default to direct mode
  return 'direct';
}

export async function createSshSession({ prisma, deviceId, user }) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new Error('Device not found');
  if (user?.tenantId && device.tenantId !== user.tenantId && user.role !== 'admin') {
    throw new Error('Forbidden');
  }

  // Determine connection mode
  const connectionMode = await getConnectionMode(device, prisma);

  // For direct mode, require credentials
  if (connectionMode === 'direct' && (!device.credUsername || !device.credPasswordEnc)) {
    throw new Error('Credenciais de acesso ausentes neste dispositivo');
  }

  // For Jumpserver mode, require asset mapping
  if (connectionMode === 'jumpserver' && !device.jumpserverAssetId) {
    throw new Error('Dispositivo não mapeado no Jumpserver');
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
      jumpserverConnectionMode: connectionMode,
    },
  });

  return {
    id: session.id,
    key: sessionKey,
    device: { id: device.id, name: device.name, ipAddress: device.ipAddress },
    connectionMode,
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

  // Route to appropriate handler based on connection mode
  const connectionMode = session.jumpserverConnectionMode || 'direct';

  if (connectionMode === 'jumpserver') {
    await handleJumpserverWebsocket({ prisma, session, device, ws, user });
  } else {
    await handleDirectSshWebsocket({ prisma, session, device, ws, user });
  }
}

/**
 * Handle WebSocket via Jumpserver Koko proxy
 */
async function handleJumpserverWebsocket({ prisma, session, device, ws, user }) {
  const jumpserverClient = await createJumpserverClientFromConfig(prisma, device.tenantId);

  if (!jumpserverClient) {
    ws.close(1011, 'Jumpserver não configurado');
    return;
  }

  let kokoWs = null;
  let closed = false;
  const startedAt = Date.now();
  const recorder = createSessionRecorder(session.id);

  try {
    // Request connection token from Jumpserver
    const tokenData = await jumpserverClient.requestConnectionToken({
      userId: user.email || `user_${user.sub}`,
      assetId: device.jumpserverAssetId,
      systemUserId: device.jumpserverSystemUser || 'default',
    });

    // Update session with Jumpserver session ID
    await prisma.sshSession.update({
      where: { id: session.id },
      data: {
        status: 'connecting',
        startedAt: new Date(),
        logPath: recorder.filePath,
        jumpserverSessionId: tokenData.token,
      },
    });

    // Build Koko WebSocket URL
    const kokoWsUrl = jumpserverClient.buildKokoWebSocketUrl(tokenData.token);

    // Create WebSocket proxy to Jumpserver
    kokoWs = new WebSocket(kokoWsUrl);

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

    kokoWs.on('open', () => {
      prisma.sshSession.update({
        where: { id: session.id },
        data: { status: 'active' },
      }).catch(() => { });
      ws.send(JSON.stringify({ type: 'info', message: 'Conectado via Jumpserver' }));
    });

    kokoWs.on('message', (data) => {
      // Koko sends data in specific format, we need to parse and forward
      try {
        const message = data.toString();
        recorder.write('OUT', message);
        ws.send(JSON.stringify({ type: 'data', payload: message }));
      } catch (e) {
        console.warn('[Jumpserver][WARN] message parse error:', e.message);
      }
    });

    kokoWs.on('error', (err) => {
      console.error('[Jumpserver][ERROR]', err.message);
      ws.send(JSON.stringify({ type: 'error', message: 'Erro na conexão com Jumpserver' }));
      finalize('error', err.message);
    });

    kokoWs.on('close', () => {
      ws.close(1000, 'Sessão encerrada');
      finalize('closed');
    });

    // Client -> Koko
    ws.on('message', (raw) => {
      if (kokoWs.readyState !== WebSocket.OPEN) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data' && typeof msg.payload === 'string') {
          kokoWs.send(msg.payload);
          recorder.write('IN', msg.payload);
        }
        if (msg.type === 'resize') {
          // Koko supports resize via JSON message
          kokoWs.send(JSON.stringify({
            type: 'TERMINAL_RESIZE',
            rows: msg.rows,
            cols: msg.cols,
          }));
        }
      } catch (e) {
        console.warn('[Jumpserver][WARN] client message error:', e.message);
      }
    });

    ws.on('close', () => {
      kokoWs?.close();
      finalize('closed', 'client-disconnected');
    });

  } catch (error) {
    console.error('[Jumpserver][ERROR] Connection failed:', error.message);
    ws.send(JSON.stringify({ type: 'error', message: error.message }));
    ws.close(1011, error.message);
    recorder.close('error');
  }
}

/**
 * Handle direct SSH WebSocket (original implementation)
 */
async function handleDirectSshWebsocket({ prisma, session, device, ws, user }) {
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
    }).catch(() => { });
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
    readyTimeout: 30000,
    keepaliveInterval: 10000,
    algorithms: {
      kex: [
        'diffie-hellman-group1-sha1',
        'diffie-hellman-group14-sha1',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256'
      ],
      cipher: [
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes128-cbc',
        '3des-cbc',
        'aes192-cbc',
        'aes256-cbc'
      ],
      serverHostKey: [
        'ssh-rsa',
        'ssh-dss',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521'
      ],
      hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512',
        'hmac-sha1'
      ]
    },
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
