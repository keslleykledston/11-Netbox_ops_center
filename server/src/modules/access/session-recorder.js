import fs from 'node:fs';
import path from 'node:path';

const SESSION_DIR = process.env.SSH_SESSION_DIR || path.resolve(process.cwd(), '../ssh-sessions');

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function createSessionRecorder(sessionId) {
  ensureDir();
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `session-${sessionId}-${suffix}.log`;
  const filePath = path.join(SESSION_DIR, filename);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  stream.write(`# Session ${sessionId} started at ${new Date().toISOString()}\n`);
  return {
    filePath,
    write(direction, chunk) {
      const time = new Date().toISOString();
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stream.write(`[${time}] [${direction}] ${text}`);
    },
    close(status = 'closed') {
      stream.write(`# Session ended at ${new Date().toISOString()} with status=${status}\n`);
      stream.end();
    },
  };
}

export function readSessionLog(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

export function getSessionsDir() {
  ensureDir();
  return SESSION_DIR;
}
