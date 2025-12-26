import fs from 'fs/promises';
import path from 'path';
import { decryptSecret } from '../../cred.js';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

const BASE_URL = (process.env.OXIDIZED_API_URL || 'http://oxidized:8888').replace(/\/$/, '');
const ROUTER_DB_PATH = process.env.OXIDIZED_ROUTER_DB || '/etc/oxidized/router.db';
const OX_HTTP_SOURCE_URL = (process.env.OXIDIZED_HTTP_SOURCE_URL || 'http://backend:4000/oxidized/nodes').replace(/\/$/, '');
const CONFIG_DIR = path.dirname(ROUTER_DB_PATH);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config');
const GIT_REPO_PATH = path.join(CONFIG_DIR, 'git-repos/default.git');
const GIT_REPOS_BASE = path.join(CONFIG_DIR, 'git-repos');

const MANAGED_BEGIN = '# BEGIN NETBOX_OPS_CENTER';
const MANAGED_END = '# END NETBOX_OPS_CENTER';
const MANAGED_REGEX = new RegExp(`${MANAGED_BEGIN}[\\s\\S]*?${MANAGED_END}`, 'm');

let lastRouterError = null;

function sanitizeField(value) {
    return String(value ?? '')
        .replace(/[\n\r:]/g, ' ')
        .trim();
}

function shellQuote(value) {
    return `'${String(value ?? '').replace(/'/g, `'\"'\"'`)}'`;
}

async function ensureJumpserverAskpassScript() {
    const password = String(process.env.JUMPSERVER_PASSWORD || '').trim();
    if (!password) return;
    const askpassPath = path.join(CONFIG_DIR, 'ssh-askpass.sh');
    const content = `#!/bin/sh\nprintf %s ${shellQuote(password)}\n`;
    try {
        const uid = Number(process.env.OXIDIZED_UID || 30000);
        const gid = Number(process.env.OXIDIZED_GID || uid);
        await fs.writeFile(askpassPath, content, { mode: 0o700 });
        await fs.chmod(askpassPath, 0o700);
        if (Number.isFinite(uid) && Number.isFinite(gid)) {
            await fs.chown(askpassPath, uid, gid);
        }
    } catch (err) {
        console.warn('[OXIDIZED] Failed to write SSH_ASKPASS script:', err?.message || err);
    }
}

export function guessModel(device) {
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

function normalizeNodeName(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[\\s:]+/g, '_');
}

function buildNodeNameCandidates(node) {
    const raw = String(node || '').trim();
    const candidates = new Set();
    const add = (n) => {
        const val = String(n || '').trim();
        if (val) candidates.add(val);
    };
    add(raw);
    add(raw.replace(/[:]/g, '_'));
    add(raw.replace(/[:]/g, ' '));
    add(raw.replace(/[\\s:]+/g, '_'));
    add(raw.replace(/[\\s:]+/g, '-'));
    return Array.from(candidates.values());
}

async function listRepoDirs() {
    try {
        const entries = await fs.readdir(GIT_REPOS_BASE, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory() && e.name.endsWith('.git')).map((e) => path.join(GIT_REPOS_BASE, e.name));
        if (dirs.length === 0) dirs.push(GIT_REPO_PATH);
        return dirs;
    } catch {
        return [GIT_REPO_PATH];
    }
}

async function listNodePaths(node, repoPath = GIT_REPO_PATH) {
    const normTarget = normalizeNodeName(node);
    if (!normTarget) return [];
    try {
        const { stdout } = await execAsync(`git --git-dir=${JSON.stringify(repoPath)} ls-tree -r --name-only HEAD`);
        const paths = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        return paths.filter((p) => {
            const base = p.split('/').pop() || '';
            return normalizeNodeName(base) === normTarget;
        });
    } catch (err) {
        console.warn('[OXIDIZED] Falha ao listar caminhos do git:', err?.message || err);
        return [];
    }
}

async function resolveNodePathInGit(repoPath, oid, node) {
    const options = buildNodeNameCandidates(node);
    for (const candidate of options) {
        try {
            await execAsync(`git --git-dir=${JSON.stringify(repoPath)} cat-file -e ${JSON.stringify(`${oid}:${candidate}`)}`);
            return { ok: true, path: candidate };
        } catch {
            // try next candidate
        }
    }
    // Fallback: procurar pelo basename na árvore (suporta caminhos com diretório de grupo)
    const targetNorm = normalizeNodeName(node);
    if (targetNorm) {
        try {
            const { stdout } = await execAsync(`git --git-dir=${JSON.stringify(repoPath)} ls-tree -r --name-only HEAD`);
            const paths = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
            for (const p of paths) {
                const base = p.split('/').pop() || '';
                if (normalizeNodeName(base) === targetNorm) {
                    try {
                        await execAsync(`git --git-dir=${JSON.stringify(repoPath)} cat-file -e ${JSON.stringify(`${oid}:${p}`)}`);
                        return { ok: true, path: p };
                    } catch {
                        continue;
                    }
                }
            }
        } catch (err) {
            console.warn('[OXIDIZED] Falha ao listar árvore do git:', err?.message || err);
        }
    }

    return { ok: false, tried: options };
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
        await ensureJumpserverAskpassScript();

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
    auth_methods: ["none", "publickey", "password", "keyboard-interactive"]
    vars:
      ssh_kex: diffie-hellman-group1-sha1,diffie-hellman-group14-sha1,diffie-hellman-group-exchange-sha1,diffie-hellman-group-exchange-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521
      ssh_host_key: ssh-rsa,ssh-dss,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,ed25519
      ssh_hmac: hmac-sha1,hmac-sha1-96,hmac-sha2-256,hmac-sha2-512,hmac-md5,hmac-md5-96
      ssh_cipher: aes128-cbc,aes192-cbc,aes256-cbc,aes128-ctr,aes192-ctr,aes256-ctr,3des-cbc
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
    url: ${OX_HTTP_SOURCE_URL}
    map:
      name: name
      ip: ip
      model: model
      group: group
      username: username
      password: password
    vars_map:
      ssh_port: ssh_port
      ssh_proxy: ssh_proxy
      ssh_proxy_port: ssh_proxy_port
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

export async function getLatestOxidizedVersionTimes(names = []) {
    const versions = new Map();
    const uniqueNames = Array.from(new Set((names || []).filter(Boolean)));
    if (uniqueNames.length === 0) return { ok: true, versions };

    try {
        const repos = await listRepoDirs();
        for (const repoPath of repos) {
            // Mapear nomes para caminhos reais (quando há diretório de grupo)
            const resolvedPaths = new Map();
            const nameLookup = new Map();
            try {
                const { stdout: lsTree } = await execAsync(`git --git-dir=${JSON.stringify(repoPath)} ls-tree -r --name-only HEAD`);
                const treePaths = lsTree.split('\n').map((l) => l.trim()).filter(Boolean);
                const normalizedTree = new Map();
                for (const p of treePaths) {
                    const base = p.split('/').pop() || '';
                    const norm = normalizeNodeName(base);
                    if (!normalizedTree.has(norm)) normalizedTree.set(norm, p);
                }
                for (const name of uniqueNames) {
                    const norm = normalizeNodeName(name);
                    if (normalizedTree.has(norm)) {
                        resolvedPaths.set(name, normalizedTree.get(norm));
                    }
                }
            } catch (err) {
                console.warn('[OXIDIZED] Falha ao mapear caminhos do git:', err?.message || err);
            }

            const pathsToQuery = uniqueNames.map((n) => resolvedPaths.get(n) || n);

            pathsToQuery.forEach((p, idx) => {
                nameLookup.set(p, uniqueNames[idx]);
                const base = p.split('/').pop() || p;
                nameLookup.set(base, uniqueNames[idx]);
            });

            const namesArg = pathsToQuery.map((n) => JSON.stringify(n)).join(' ');
            const cmd = `git --git-dir=${JSON.stringify(repoPath)} log --format=%cI --name-only -- ${namesArg}`;
            const { stdout } = await execAsync(cmd);
            const lines = stdout.split('\n');
            let currentTime = null;

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) {
                    currentTime = null;
                    continue;
                }
                if (/^\\d{4}-\\d{2}-\\d{2}T/.test(line)) {
                    currentTime = line;
                    continue;
                }
                const deviceName = nameLookup.get(line) || nameLookup.get(line.split('/').pop() || '');
                if (currentTime && deviceName && !versions.has(deviceName)) {
                    versions.set(deviceName, currentTime);
                    if (versions.size === uniqueNames.length) break;
                }
            }
            if (versions.size === uniqueNames.length) break;
        }

        return { ok: true, versions };
    } catch (err) {
        console.warn('[OXIDIZED] Falha ao calcular última versão:', err?.message || err);
        return { ok: false, error: err?.message || String(err), versions };
    }
}

export async function getOxidizedDiff(node, oid1, oid2) {
    try {
        // Verify repo exists
        await fs.access(GIT_REPO_PATH);

        const repos = await listRepoDirs();
        for (const repoPath of repos) {
            const candidates = await listNodePaths(node, repoPath);
            const resolved = await resolveNodePathInGit(repoPath, oid1, node);
            const fallback = resolved.ok ? resolved.path : (candidates[0] || null);
            if (!fallback) continue;

            const cmd = `git --git-dir="${repoPath}" diff "${oid1}" "${oid2}" -- "${fallback}"`;
            const { stdout } = await execAsync(cmd);
            return { ok: true, diff: stdout, path: fallback, paths: candidates, repo: repoPath };
        }

        return { ok: false, error: 'Arquivo não encontrado no repositório para o node informado', paths: [], repo: null };
    } catch (err) {
        console.error('[OXIDIZED] Diff error:', err);
        return { ok: false, error: err.message || String(err) };
    }
}

export async function getOxidizedContent(node, oid) {
    try {
        await fs.access(GIT_REPO_PATH);
        const repos = await listRepoDirs();
        for (const repoPath of repos) {
            const candidates = await listNodePaths(node, repoPath);
            const resolved = await resolveNodePathInGit(repoPath, oid, node);
            const target = resolved.ok ? resolved.path : (candidates[0] || node);
            try {
                const cmd = `git --git-dir="${repoPath}" show "${oid}:${target}"`;
                const { stdout } = await execAsync(cmd);
                return { ok: true, content: stdout, path: target, paths: candidates, repo: repoPath };
            } catch {
                // try next repo
                continue;
            }
        }
        return { ok: false, error: 'Arquivo não encontrado no repositório para o node informado', path: null, paths: [], repo: null };
    } catch (err) {
        console.error('[OXIDIZED] Content error:', err);
        return { ok: false, error: err.message || String(err) };
    }
}
