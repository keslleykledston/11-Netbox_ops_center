import fs from 'fs/promises';
import path from 'path';
import { decryptSecret } from '../../cred.js';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

const BASE_URL = (process.env.OXIDIZED_API_URL || 'http://oxidized:8888').replace(/\/$/, '');
const ROUTER_DB_PATH = process.env.OXIDIZED_ROUTER_DB || '/etc/oxidized/router.db';
const CONFIG_DIR = path.dirname(ROUTER_DB_PATH);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config');

const MANAGED_BEGIN = '# BEGIN NETBOX_OPS_CENTER';
const MANAGED_END = '# END NETBOX_OPS_CENTER';
const MANAGED_REGEX = new RegExp(`${MANAGED_BEGIN}[\\s\\S]*?${MANAGED_END}`, 'm');

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

export async function ensureOxidizedConfig(force = false) {
    try {
        // Check if config exists
        if (!force) {
            try {
                await fs.access(CONFIG_PATH);
                return; // Exists, nothing to do
            } catch {
                // Doesn't exist, proceed to create
            }
        }

        console.log(`[OXIDIZED] ${force ? 'Regenerating' : 'Generating'} config...`);
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.mkdir(path.join(CONFIG_DIR, 'git-repos'), { recursive: true });

        const defaultConfig = `---
username: username
password: password
model: ios
resolve_dns: false
interval: 3600
use_syslog: false
debug: true
threads: 30
timeout: 60
retries: 3
prompt: !ruby/regexp /^([\\w.@-]+[#> ]\\s?)$/
rest: 0.0.0.0:8888
next_adds_job: true
vars:
  ssh_no_keepalive: true
groups: {}
models: {}
pid: "/home/oxidized/.config/oxidized/pid"
input:
  default: ssh, telnet
  debug: true
  ssh:
    secure: false
    keepalive: false
output:
  default: git
  git:
    user: oxidized
    email: oxidized@example.com
    repo: "/home/oxidized/.config/oxidized/git-repos/default.git"
  file:
    directory: "/home/oxidized/.config/oxidized/configs"
source:
  default: http
  http:
    url: http://netbox-ops-center-app:4000/oxidized/nodes
    map:
      name: name
      ip: ip
      model: model
      group: group
      username: username
      password: password
    vars_map:
      ssh_port: ssh_port
    gpg: false
  netbox:
    url: "${process.env.NETBOX_URL || 'http://netbox:8000'}"
    token: "${process.env.NETBOX_TOKEN || ''}"
    filter:
      status: active
      cf_backup: true
      has_primary_ip: true
      name: !ruby/regexp /^(?!4WNET-BVA-BRT-RX|INFORR-BVB-JCL-RX)/
    map:
      name: name
      ip: primary_ip.address
      model: platform.slug
      group: site.slug
    vars_map:
      ssh_port: cf_ssh_port
      username: cf_username
      password: cf_password
model_map:
  cisco: ios
  juniper: junos
  huawei: vrp
`;
        await fs.writeFile(CONFIG_PATH, defaultConfig, 'utf8');
        console.log('[OXIDIZED] Default config generated at', CONFIG_PATH);
    } catch (err) {
        console.warn('[OXIDIZED] Failed to ensure config:', err.message);
    }
}

async function ensureRouterFile() {
    if (!ROUTER_DB_PATH) return null;
    try {
        const data = await fs.readFile(ROUTER_DB_PATH, 'utf8');
        return data;
    } catch (err) {
        if (err?.code === 'ENOENT') {
            try {
                await fs.mkdir(path.dirname(ROUTER_DB_PATH), { recursive: true });
                const initial = `${MANAGED_BEGIN}\n${MANAGED_END}\n`;
                await fs.writeFile(ROUTER_DB_PATH, initial, 'utf8');

                // Also ensure config exists whenever we are touching the directory
                await ensureOxidizedConfig();

                return initial;
            } catch (mkdirErr) {
                lastRouterError = mkdirErr?.message || String(mkdirErr);
                console.warn('[OXIDIZED] Falha ao criar router.db:', lastRouterError);
                return null;
            }
        }
        lastRouterError = err?.message || String(err);
        console.warn('[OXIDIZED] Falha ao ler router.db:', lastRouterError);
        return null;
    }
}

function replaceManagedBlock(content, newLines) {
    const block = `${MANAGED_BEGIN}\n${newLines.join('\n')}\n${MANAGED_END}`;

    // Remove all existing blocks (global flag)
    const globalRegex = new RegExp(`${MANAGED_BEGIN}[\\s\\S]*?${MANAGED_END}\\n?`, 'gm');
    const cleaned = content.replace(globalRegex, '').trim();

    // Append new block
    return `${cleaned}\n\n${block}\n`;
}

export async function syncRouterDb(devices) {
    if (!ROUTER_DB_PATH) {
        lastRouterError = 'OXIDIZED_ROUTER_DB não configurado';
        return { success: false, message: lastRouterError };
    }
    const file = await ensureRouterFile();
    if (!file) return { success: false, message: lastRouterError || 'router.db indisponível' };

    // Ensure config exists (force regenerate to apply latest settings)
    await ensureOxidizedConfig(true);

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
        const timeout = setTimeout(() => controller.abort(), 5000);
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

    // Sanitize nodes
    const nodes = Array.isArray(result.data) ? result.data.map(node => ({
        ...node,
        last: node.last ? {
            ...node.last,
            end: node.last.end && node.last.end !== '0001-01-01 00:00:00 +0000' ? node.last.end : null
        } : null,
        time: node.time && node.time !== '0001-01-01 00:00:00 +0000' ? node.time : null
    })) : [];

    return { ok: true, nodes, baseUrl: BASE_URL };
}

export async function fetchOxidizedVersions(nodeFull) {
    const query = encodeURIComponent(nodeFull);
    const result = await fetchJson(`/node/version.json?node_full=${query}`);
    if (!result.ok) return result;
    return { ok: true, versions: Array.isArray(result.data) ? result.data : [] };
}

export async function getOxidizedDiff(node, oid1, oid2) {
    const repoPath = path.join(path.dirname(ROUTER_DB_PATH), 'git-repos/default.git');
    try {
        // Verify repo exists
        await fs.access(repoPath);

        // Use git diff to get the patch
        // We use --no-color to get raw text, but we could use --color=always if we want ANSI codes
        const cmd = `git --git-dir="${repoPath}" diff "${oid1}" "${oid2}" -- "${node}"`;
        const { stdout } = await execAsync(cmd);
        return { ok: true, diff: stdout };
    } catch (err) {
        console.error('[OXIDIZED] Diff error:', err);
        return { ok: false, error: err.message || String(err) };
    }
}

export async function getOxidizedContent(node, oid) {
    const repoPath = path.join(path.dirname(ROUTER_DB_PATH), 'git-repos/default.git');
    try {
        await fs.access(repoPath);
        // git show <oid>:<node>
        // Note: The file path in the repo is usually just the node name, but we verified it with ls-tree earlier.
        // It was "INFORR-BVB-JCL-RX" (no directory).
        const cmd = `git --git-dir="${repoPath}" show "${oid}:${node}"`;
        const { stdout } = await execAsync(cmd);
        return { ok: true, content: stdout };
    } catch (err) {
        console.error('[OXIDIZED] Content error:', err);
        return { ok: false, error: err.message || String(err) };
    }
}
