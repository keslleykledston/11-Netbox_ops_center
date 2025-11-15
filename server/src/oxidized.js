import fs from 'fs/promises';
import path from 'path';
import { decryptSecret } from './cred.js';

const BASE_URL = (process.env.OXIDIZED_API_URL || 'http://localhost:8888').replace(/\/$/, '');
const ROUTER_DB_PATH = process.env.OXIDIZED_ROUTER_DB || '/etc/oxidized/router.db';
const MANAGED_BEGIN = '# BEGIN NETBOX_OPS_CENTER';
const MANAGED_END = '# END NETBOX_OPS_CENTER';
const MANAGED_REGEX = new RegExp(`${MANAGED_BEGIN}[\s\S]*?${MANAGED_END}`, 'm');

let lastRouterError = null;

function sanitizeField(value) {
  return String(value ?? '')
    .replace(/[\n\r:]/g, ' ')
    .trim();
}

function guessModel(device) {
  const model = String(device.model || '').toLowerCase();
  const vendor = String(device.manufacturer || '').toLowerCase();
  if (model.includes('vrp') || vendor.includes('huawei')) return 'vrp';
  if (model.includes('junos') || vendor.includes('juniper')) return 'junos';
  if (model.includes('nx') || vendor.includes('nexus')) return 'nxos';
  if (model.includes('forti') || vendor.includes('fortinet')) return 'fortios';
  return 'ios';
}

function buildRouterEntry(device) {
  if (!device.backupEnabled) return null;
  if (!device.credUsername || !device.credPasswordEnc) return null;
  const password = decryptSecret(device.credPasswordEnc);
  if (!password) return null;
  const sshPort = Number(device.sshPort || 22);
  const ip = sanitizeField(device.ipAddress);
  const login = sanitizeField(device.credUsername);
  const pass = sanitizeField(password);
  const name = sanitizeField(device.name);
  if (!name || !ip || !login || !pass) return null;
  const model = sanitizeField(guessModel(device));
  const input = 'ssh';
  return `${name}:${ip}:${model}:${input}:${login}:${pass}:${sshPort}`;
}

async function ensureRouterFile() {
  if (!ROUTER_DB_PATH) return null;
  try {
    const data = await fs.readFile(ROUTER_DB_PATH, 'utf8');
    return data;
  } catch (err) {
    if (err?.code === 'ENOENT') {
      await fs.mkdir(path.dirname(ROUTER_DB_PATH), { recursive: true });
      const initial = `${MANAGED_BEGIN}\n${MANAGED_END}\n`;
      await fs.writeFile(ROUTER_DB_PATH, initial, 'utf8');
      return initial;
    }
    lastRouterError = err?.message || String(err);
    console.warn('[OXIDIZED] Falha ao ler router.db:', lastRouterError);
    return null;
  }
}

function replaceManagedBlock(content, newLines) {
  const block = `${MANAGED_BEGIN}\n${newLines.join('\n')}\n${MANAGED_END}`;
  if (MANAGED_REGEX.test(content)) {
    return content.replace(MANAGED_REGEX, block);
  }
  const trimmed = content.trimEnd();
  const suffix = trimmed ? `\n${block}\n` : `${block}\n`;
  return `${trimmed}${suffix}`;
}

export async function syncRouterDb(devices) {
  if (!ROUTER_DB_PATH) {
    lastRouterError = 'OXIDIZED_ROUTER_DB não configurado';
    return { success: false, message: lastRouterError };
  }
  const file = await ensureRouterFile();
  if (!file) return { success: false, message: lastRouterError || 'router.db indisponível' };
  const managedLines = devices
    .map((device) => buildRouterEntry(device))
    .filter(Boolean);
  const newContent = replaceManagedBlock(file, managedLines);
  if (newContent !== file) {
    try {
      await fs.writeFile(ROUTER_DB_PATH, newContent, 'utf8');
      lastRouterError = null;
    } catch (err) {
      lastRouterError = err?.message || String(err);
      console.warn('[OXIDIZED] Não foi possível escrever router.db:', lastRouterError);
      return { success: false, message: lastRouterError };
    }
  }
  return { success: true, message: null };
}

export async function getManagedRouterEntries() {
  if (!ROUTER_DB_PATH) return { names: new Set(), available: false };
  const file = await ensureRouterFile();
  if (!file) return { names: new Set(), available: false };
  const match = file.match(MANAGED_REGEX);
  if (!match) return { names: new Set(), available: true };
  const body = match[0]
    .replace(MANAGED_BEGIN, '')
    .replace(MANAGED_END, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const names = new Set(body.map((line) => line.split(':')[0] || '').filter(Boolean));
  return { names, available: true };
}

export function getRouterDbStatus() {
  return {
    path: ROUTER_DB_PATH,
    writable: !lastRouterError,
    error: lastRouterError,
  };
}

async function fetchJson(pathname) {
  if (!BASE_URL) {
    return { ok: false, error: 'OXIDIZED_API_URL não configurado' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${BASE_URL}${pathname}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function fetchOxidizedNodes() {
  const result = await fetchJson('/nodes.json');
  if (!result.ok) return { ...result, nodes: [] };
  return { ok: true, nodes: Array.isArray(result.data) ? result.data : [], baseUrl: BASE_URL };
}

export async function fetchOxidizedVersions(nodeFull) {
  const query = encodeURIComponent(nodeFull);
  const result = await fetchJson(`/node/version.json?node_full=${query}`);
  if (!result.ok) return result;
  return { ok: true, versions: Array.isArray(result.data) ? result.data : [] };
}
