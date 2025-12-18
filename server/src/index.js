import "dotenv/config";
import express from "express";
import expressWs from "express-ws";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import os from "node:os";
import { getNetboxCatalog } from "./netbox.js";
import { encryptSecret, decryptSecret } from "./cred.js";
import { fetchOxidizedNodes, fetchOxidizedVersions, syncRouterDb, getManagedRouterEntries, getRouterDbStatus, getOxidizedDiff, getOxidizedContent, getLatestOxidizedVersionTimes } from "./modules/monitor/oxidized-service.js";
import { testJumpserverConnection, findAssetByIp, getConnectUrl } from "./jumpserver.js";
import {
  addNetboxSyncJob,
  addOxidizedSyncJob,
  addSnmpDiscoveryJob,
  addDeviceScanJob,
  addCredentialCheckJob,
  addConnectivityTestJob,
  addCheckmkSyncJob,
  addLibreNmsSyncJob,
  getJobStatus,
  getQueueJobs,
  closeQueues,
  getAllQueues,
  QUEUE_NAMES,
} from "./queues/index.js";
import { subscribeJobEvents, unsubscribeJobEvents } from "./queues/events.js";
import { createSshSession, listSshSessions, getSessionLog, handleSshWebsocket } from "./modules/access/ssh-service.js";
import { JumpserverClient, createJumpserverClientFromConfig } from "./modules/access/jumpserver-client.js";
import { isCheckmkAvailable, getHostsStatus } from "./modules/monitor/checkmk-service.js";
import { getMetrics, httpMetricsMiddleware, startMetricsCollection } from "./modules/observability/metrics.js";
import { createSafeLogger } from "./modules/observability/log-sanitizer.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();
const app = express();
expressWs(app);

app.use(cors());
app.use(express.json());

// Prometheus metrics middleware (track all HTTP requests)
app.use(httpMetricsMiddleware);

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const OXIDIZED_ENABLED = Boolean(process.env.OXIDIZED_API_URL || process.env.OXIDIZED_ROUTER_DB);
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'suporte@suporte.com.br';
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Ops_pass_';

// Simple startup validation and summary
(() => {
  const dbUrl = process.env.DATABASE_URL || "(default: postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops)";
  const nbUrl = process.env.NETBOX_URL;
  const nbToken = process.env.NETBOX_TOKEN;
  const nbGroup = process.env.NETBOX_TENANT_GROUP_FILTER || "K3G Solutions";
  const jsUrl = process.env.JUMPSERVER_URL;
  const jsToken = process.env.JUMPSERVER_TOKEN || process.env.JUMPSERVER_API_KEY;
  const oxUrl = process.env.OXIDIZED_API_URL;
  const oxRouter = process.env.OXIDIZED_ROUTER_DB;

  console.log("[ENV] API PORT=", PORT);
  console.log("[ENV] DATABASE_URL=", dbUrl);
  console.log("[ENV] NETBOX_TENANT_GROUP_FILTER=", nbGroup);
  if (oxUrl) console.log("[ENV] OXIDIZED_API_URL=", oxUrl);
  if (oxRouter) console.log("[ENV] OXIDIZED_ROUTER_DB=", oxRouter);

  if (!nbUrl) console.warn("[ENV][WARN] NETBOX_URL not set — NetBox sync will require url in request body.");
  if (!nbToken) console.warn("[ENV][WARN] NETBOX_TOKEN not set — NetBox sync will require token in request body.");
  if (!jsUrl) console.warn("[ENV][WARN] JUMPSERVER_URL not set — Jumpserver tests will require url in request body.");
  if (!jsToken) console.warn("[ENV][WARN] JUMPSERVER_TOKEN/API_KEY not set — Jumpserver tests may respond unauthorized unless provided in body.");
  if (JWT_SECRET === "dev_secret") console.warn("[ENV][WARN] Using default JWT secret — set JWT_SECRET in production.");
  if (!oxUrl) console.warn("[ENV][WARN] OXIDIZED_API_URL not set — status e versões não estarão disponíveis.");
  if (!oxRouter) console.warn("[ENV][WARN] OXIDIZED_ROUTER_DB not set — atualização do router.db será ignorada.");
})();

// Background bootstrap tasks
async function ensureDefaultTenant() {
  try {
    const existing = await prisma.tenant.findUnique({ where: { name: 'default' } });
    if (!existing) {
      await prisma.tenant.create({ data: { name: 'default', description: 'Default tenant' } });
      console.log('[BOOT] Created default tenant');
    }
  } catch (e) {
    console.warn('[BOOT][WARN] ensureDefaultTenant failed:', String(e?.message || e));
  }
}

async function ensureDefaultAdminUser() {
  try {
    const admin = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } }).catch(() => null);
    if (!admin) {
      const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await prisma.user.create({
        data: {
          email: DEFAULT_ADMIN_EMAIL,
          username: DEFAULT_ADMIN_USERNAME,
          passwordHash: hash,
          role: 'admin',
          isActive: true,
          mustResetPassword: true,
          tenantId: null,
        },
      });
      console.log('[BOOT] Created default admin user');
    }
  } catch (e) {
    console.warn('[BOOT][WARN] ensureDefaultAdminUser failed:', String(e?.message || e));
  }
}

async function lookupAsnName(asn) {
  const enabled = (process.env.ASN_LOOKUP_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return null;
  const endpoints = [];
  const tpl = process.env.ASN_LOOKUP_URL || '';
  if (tpl.includes('{asn}')) endpoints.push(tpl.replace('{asn}', String(asn)));
  // fallbacks
  endpoints.push(`https://api.bgpview.io/asn/${asn}`);
  endpoints.push(`https://rdap.apnic.net/autnum/${asn}`);
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (!r.ok) continue;
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) continue;
      const j = await r.json();
      // bgpview
      if (j?.data?.name) return String(j.data.name);
      // rdap
      if (j?.name) return String(j.name);
      if (j?.entities && Array.isArray(j.entities)) {
        const v = j.entities.find((e) => e?.vcardArray && Array.isArray(e.vcardArray));
        const card = v?.vcardArray?.[1];
        const fn = Array.isArray(card) ? card.find((x) => x?.[0] === 'fn') : null;
        if (fn && fn[3]) return String(fn[3]);
      }
    } catch { }
  }
  return null;
}

async function refreshAsnRegistryFromPeers() {
  try {
    const peers = await prisma.discoveredBgpPeer.findMany({ select: { asn: true } });
    const unique = Array.from(new Set(peers.map((p) => Number(p.asn || 0)).filter((n) => Number.isFinite(n) && n > 0)));
    if (unique.length === 0) return;
    const existing = await prisma.asnRegistry.findMany({ where: { asn: { in: unique } } });
    const known = new Set(existing.filter((e) => e.name && String(e.name).trim().length > 0).map((e) => Number(e.asn)));
    const toLookup = unique.filter((n) => !known.has(n));
    for (const asn of toLookup) {
      const name = await lookupAsnName(asn);
      if (name) {
        await prisma.asnRegistry.upsert({ where: { asn }, update: { name }, create: { asn, name } });
        console.log(`[ASN] Resolved AS${asn} => ${name}`);
      }
    }
    // Update peers with resolved names
    const reg = await prisma.asnRegistry.findMany({ where: { asn: { in: unique } } });
    const map = new Map(reg.map(r => [Number(r.asn), r.name]));
    for (const asn of unique) {
      const name = map.get(asn) || null;
      if (name) {
        await prisma.discoveredBgpPeer.updateMany({ where: { asn }, data: { asnName: name } });
      }
    }
  } catch (e) {
    console.warn('[BOOT][WARN] refreshAsnRegistryFromPeers failed:', String(e?.message || e));
  }
}

async function bootstrapBackground() {
  await ensureDefaultTenant();
  await ensureDefaultAdminUser();
  // Kick off ASN refresh in background (non-blocking)
  refreshAsnRegistryFromPeers();
  syncRouterDbFromDb();

  // Start Prometheus metrics collection (every 15s)
  const queueMap = getAllQueues();
  startMetricsCollection({ queueMap, prisma, interval: 15000 });
  console.log('[METRICS] Started metrics collection');
}

async function logAudit(req, action, detailsObj) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req?.user?.sub ? String(req.user.sub) : null,
        userRole: req?.user?.role || null,
        tenantId: req?.user?.tenantId || null,
        action,
        details: detailsObj ? JSON.stringify(detailsObj) : null,
      },
    });
  } catch (e) {
    console.warn("[AUDIT][WARN]", String(e?.message || e));
  }
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenantId || null, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const [scheme, token] = h.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }
  return res.status(401).json({ error: "Unauthorized" });
}

function requireScopeOrAdmin(req, res, next) {
  if (req.user?.tenantId) return next();
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}

function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Admin only" });
}

function buildDeviceWhere(req) {
  let where = {};
  if (req.user?.tenantId) {
    where = { tenantId: req.user.tenantId };
  } else if (req.query.tenantId) {
    const tid = Number(req.query.tenantId);
    if (Number.isFinite(tid)) where = { tenantId: tid };
  }
  return where;
}

function sanitizeDeviceOutput(device) {
  const { credPasswordEnc, ...rest } = device;
  return {
    ...rest,
    credUsername: device.credUsername || null,
    hasCredPassword: !!credPasswordEnc,
  };
}

async function syncRouterDbFromDb() {
  if (!OXIDIZED_ENABLED) return;
  try {
    const devices = await prisma.device.findMany({
      where: { backupEnabled: true },
      select: {
        id: true,
        name: true,
        ipAddress: true,
        model: true,
        manufacturer: true,
        credUsername: true,
        credPasswordEnc: true,
        sshPort: true,
        backupEnabled: true,
      },
    });
    await syncRouterDb(devices);
  } catch (err) {
    console.warn('[BACKUP][WARN] Falha ao sincronizar router.db:', String(err?.message || err));
  }
}

async function enqueueCheckmkSync(action, device, userId) {
  if (!device) return;
  try {
    const payload = {
      id: device.id,
      name: device.name,
      hostname: device.hostname,
      ipAddress: device.ipAddress,
      deviceType: device.deviceType,
      manufacturer: device.manufacturer,
    };
    await addCheckmkSyncJob(action, device.id, payload, userId || null);
  } catch (err) {
    console.warn('[CHECKMK][WARN] Falha ao enfileirar job:', err?.message || err);
  }
}

async function enqueueLibreNmsSync(action, device, userId) {
  if (!device) return;
  if (!device.monitoringEnabled) return; // Only sync if monitoring is enabled
  try {
    const payload = {
      id: device.id,
      name: device.name,
      hostname: device.hostname || device.name,
      ipAddress: device.ipAddress,
      deviceType: device.deviceType,
      manufacturer: device.manufacturer,
      model: device.model,
      snmpVersion: device.snmpVersion,
      snmpCommunity: device.snmpCommunity,
      snmpPort: device.snmpPort || 161,
    };
    await addLibreNmsSyncJob(action, device.id, payload, userId || null);
  } catch (err) {
    console.warn('[LIBRENMS][WARN] Falha ao enfileirar job:', err?.message || err);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (err) {
    console.error('[METRICS] Failed to generate metrics:', err);
    res.status(500).send('Failed to generate metrics');
  }
});

app.post("/auth/register", async (req, res) => {
  const { email, password, username, tenantName } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  let tenant = null;
  if (tenantName) {
    tenant = await prisma.tenant.upsert({
      where: { name: tenantName },
      update: {},
      create: { name: tenantName },
    });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        username: username || email,
        passwordHash: hash,
        role: "user",
        isActive: true,
        ...(tenant ? { tenantId: tenant.id } : {}),
      },
    });
    const token = signToken(user);
    res.json({ token });
  } catch {
    res.status(409).json({ error: "User exists or invalid data" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, username, identifier, password } = req.body || {};
  const ident = email || username || identifier;
  if (!ident || !password) return res.status(400).json({ error: "identifier and password required" });

  // Allow login by email or username
  let user = null;
  // Try exact email match first
  user = await prisma.user.findUnique({ where: { email: ident } }).catch(() => null);
  if (!user) {
    // Fallback to username match (not unique); take first active
    const found = await prisma.user.findFirst({ where: { username: ident } }).catch(() => null);
    if (found) user = found;
  }
  if (!user || !user.isActive) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  if (user.mustResetPassword) {
    return res.status(403).json({ error: "Password reset required", code: "PWD_RESET_REQUIRED" });
  }
  const token = signToken(user);
  res.json({ token });
});

app.get('/auth/default-admin-hint', async (_req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } }).catch(() => null);
    const showHint = !!(user && user.mustResetPassword);
    res.json({
      showHint,
      email: showHint ? DEFAULT_ADMIN_EMAIL : null,
      password: showHint ? DEFAULT_ADMIN_PASSWORD : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Devices
app.get("/devices", requireAuth, async (req, res) => {
  const where = buildDeviceWhere(req);
  const list = await prisma.device.findMany({ where, orderBy: { id: "desc" } });

  // CheckMK status is now read from database (updated by background job)
  // No blocking HTTP calls to CheckMK, fast response
  const enriched = list.map((device) => ({
    ...sanitizeDeviceOutput(device),
    monitoring: device.checkmkStatus ? {
      state: device.checkmkStatus,
      lastCheck: device.lastCheckmkCheck,
    } : null,
  }));
  res.json(enriched);
});

import { checkDeviceSsh } from "./modules/access/ssh-check.js";

// Helper to run SSH check and update device
async function runSshCheckAndUpdate(device) {
  const result = await checkDeviceSsh(device);
  const data = {
    sshStatus: result.status,
    lastSshOk: result.ok ? new Date() : undefined,
  };

  // If SSH is OK and backup is enabled (or we want to auto-enable), we could do it here.
  // For now, just update the status.
  await prisma.device.update({ where: { id: device.id }, data });

  if (result.ok && device.backupEnabled) {
    await syncRouterDbFromDb();
  }

  return { ...device, ...data };
}

app.post("/devices", requireAuth, async (req, res) => {
  let tenantId =
    req.user.tenantId ||
    null;
  if (!tenantId && req.user.role === 'admin' && req.body?.tenantId) {
    const tid = Number(req.body.tenantId);
    if (Number.isFinite(tid)) {
      const exists = await prisma.tenant.findUnique({ where: { id: tid } });
      if (!exists) return res.status(400).json({ error: "Tenant informado não existe" });
      tenantId = tid;
    }
  }
  if (!tenantId) {
    tenantId = (await prisma.tenant.upsert({ where: { name: "default" }, update: {}, create: { name: "default" } })).id;
  }

  const {
    name,
    hostname = null,
    ipAddress,
    deviceType = "router",
    manufacturer,
    model,
    status = "inactive",
    snmpVersion = null,
    snmpCommunity = null,
    snmpPort = null,
    sshPort = null,
    username, // credentials
    password, // credentials
    backupEnabled = false,
    monitoringEnabled = false,
    oxidizedProxyId = null,
  } = req.body || {};

  if (!name || !ipAddress || !manufacturer || !model) {
    return res.status(400).json({ error: "Campos obrigatórios: name, ipAddress, manufacturer, model" });
  }

  try {
    const data = {
      tenantId,
      name,
      hostname,
      ipAddress,
      deviceType,
      manufacturer,
      model,
      status,
      snmpVersion,
      snmpCommunity,
      snmpPort: snmpPort ? Number(snmpPort) : null,
      sshPort: sshPort ? Number(sshPort) : null,
      backupEnabled: !!backupEnabled,
      monitoringEnabled: !!monitoringEnabled,
      oxidizedProxyId: oxidizedProxyId ? Number(oxidizedProxyId) : null,
    };

    if (username) data.credUsername = username;
    if (password) {
      data.credPasswordEnc = encryptSecret(password);
      data.credUpdatedAt = new Date();
    }

    let device = await prisma.device.create({ data });

    // Run SSH check in background (or await if fast enough - let's await to give immediate feedback)
    if (device.credUsername && device.credPasswordEnc) {
      device = await runSshCheckAndUpdate(device);
    }

    // Initial SNMP discovery if configured
    if (device.snmpVersion && device.snmpCommunity) {
      addSnmpDiscoveryJob(device.id, "interfaces", req.user?.sub, req.user?.tenantId).catch(() => { });
    }

    // Notificar Oxidized proxies sobre novo dispositivo
    if (device.backupEnabled) {
      notifyOxidizedProxies(device.id, 'create').catch(err => {
        console.warn('[OXIDIZED] Failed to notify proxies on device create:', err);
      });
    }

    // Adicionar dispositivo ao LibreNMS se monitoramento estiver habilitado
    enqueueLibreNmsSync('add', device, req.user?.sub).catch(() => { });

    res.status(201).json(sanitizeDeviceOutput(device));
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Dispositivo já existe (nome ou IP duplicado)" });
    }
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/devices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  const {
    name,
    hostname,
    ipAddress,
    deviceType,
    manufacturer,
    model,
    status,
    snmpVersion,
    snmpCommunity,
    snmpPort,
    sshPort,
    username,
    password,
    backupEnabled,
    monitoringEnabled,
    oxidizedProxyId,
  } = req.body || {};

  const data = {};
  if (name !== undefined) data.name = name;
  if (hostname !== undefined) data.hostname = hostname;
  if (ipAddress !== undefined) data.ipAddress = ipAddress;
  if (deviceType !== undefined) data.deviceType = deviceType;
  if (manufacturer !== undefined) data.manufacturer = manufacturer;
  if (model !== undefined) data.model = model;
  if (status !== undefined) data.status = status;
  if (snmpVersion !== undefined) data.snmpVersion = snmpVersion;
  if (snmpCommunity !== undefined) data.snmpCommunity = snmpCommunity;
  if (snmpPort !== undefined) data.snmpPort = snmpPort ? Number(snmpPort) : null;
  if (sshPort !== undefined) data.sshPort = sshPort ? Number(sshPort) : null;
  if (backupEnabled !== undefined) data.backupEnabled = !!backupEnabled;
  if (monitoringEnabled !== undefined) data.monitoringEnabled = !!monitoringEnabled;
  if (oxidizedProxyId !== undefined) data.oxidizedProxyId = oxidizedProxyId ? Number(oxidizedProxyId) : null;

  if (username !== undefined) data.credUsername = username;
  if (password !== undefined) {
    data.credPasswordEnc = password ? encryptSecret(password) : null;
    data.credUpdatedAt = new Date();
  }

  try {
    const updated = await prisma.device.update({ where: { id }, data });

    // Re-run SSH check if relevant fields changed
    if (ipAddress || sshPort || username || password || (backupEnabled && !device.backupEnabled)) {
      if (updated.credUsername && updated.credPasswordEnc) {
        await runSshCheckAndUpdate(updated);
      }
    }

    // Notificar Oxidized proxies sobre atualização do dispositivo
    const shouldNotify = ipAddress || sshPort || username || password || backupEnabled !== undefined || oxidizedProxyId !== undefined || name;
    if (shouldNotify && (updated.backupEnabled || device.backupEnabled)) {
      notifyOxidizedProxies(id, 'update').catch(err => {
        console.warn('[OXIDIZED] Failed to notify proxies on device update:', err);
      });
    }

    // Atualizar dispositivo no LibreNMS se houve mudanças relevantes
    const shouldSyncLibreNms = ipAddress || name || hostname || snmpVersion || snmpCommunity || snmpPort || monitoringEnabled !== undefined;
    if (shouldSyncLibreNms) {
      enqueueLibreNmsSync('update', updated, req.user?.sub).catch(() => { });
    }

    res.json(sanitizeDeviceOutput(await prisma.device.findUnique({ where: { id } })));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/devices/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }
  // Remover do LibreNMS antes de deletar do banco
  enqueueLibreNmsSync('delete', device, req.user?.sub).catch(() => { });

  await prisma.device.delete({ where: { id } });
  if (device.backupEnabled) {
    await syncRouterDbFromDb();
    // Notificar Oxidized proxies sobre remoção do dispositivo
    notifyOxidizedProxies(id, 'delete').catch(err => {
      console.warn('[OXIDIZED] Failed to notify proxies on device delete:', err);
    });
  }
  // DEPRECATED: CheckMK integration replaced by LibreNMS
  // enqueueCheckmkSync('delete', device, req.user?.sub).catch(() => { });
  res.status(204).send();
});

// Device credentials endpoints
app.get('/devices/:id/credentials', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const reveal = String(req.query.reveal || '').toLowerCase() === 'true' || String(req.query.reveal || '') === '1';
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) return res.status(404).json({ error: 'Not found' });
  const payload = { username: device.credUsername || '', hasPassword: !!device.credPasswordEnc };
  if (reveal) {
    payload.password = decryptSecret(device.credPasswordEnc) || '';
  }
  res.json(payload);
});

app.patch('/devices/:id/credentials', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) return res.status(404).json({ error: 'Not found' });
  const { username, password } = req.body || {};
  const data = {};
  if (typeof username === 'string') data.credUsername = username;
  if (typeof password === 'string') {
    data.credPasswordEnc = password.length > 0 ? encryptSecret(password) : null;
    data.credUpdatedAt = new Date();
  }
  const updated = await prisma.device.update({ where: { id }, data });

  // Notificar Oxidized proxies sobre atualização de credenciais
  if (device.backupEnabled && (username !== undefined || password !== undefined)) {
    notifyOxidizedProxies(id, 'update').catch(err => {
      console.warn('[OXIDIZED] Failed to notify proxies on credentials update:', err);
    });
  }

  res.json({ ok: true, id: updated.id });
});

// Update local ASN for all discovered peers of a device
app.patch('/devices/:id/local-asn', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { localAsn } = req.body || {};
    const lasn = Number(localAsn || 0) || null;
    await prisma.discoveredBgpPeer.updateMany({ where: { deviceId: id }, data: { localAsn: lasn } });
    res.json({ ok: true, localAsn: lasn });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Async discovery jobs
app.post('/devices/:id/discovery/jobs', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type } = req.body || {};
    if (!['interfaces', 'peers'].includes(type)) {
      return res.status(400).json({ error: "type deve ser 'interfaces' ou 'peers'" });
    }
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }
    const job = await addSnmpDiscoveryJob(device.id, type, req.user?.sub || null, req.user?.tenantId || null);
    res.json({ jobId: job.id, queue: 'snmp-discovery' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Device scan orchestration (enfileira polling + discovery)
app.post('/devices/:id/scan', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }
    const job = await addDeviceScanJob(device.id, req.user?.sub || null, device.tenantId || null, req.body?.reason || 'manual');
    res.json({ jobId: job.id, queue: 'device-scan' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Credential validation (NetBox Secrets + fallback)
app.post('/devices/:id/credentials/validate', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }
    const netboxConfig = {
      url: req.body?.netboxUrl || process.env.NETBOX_URL || null,
      token: req.body?.netboxToken || process.env.NETBOX_TOKEN || null,
    };
    const job = await addCredentialCheckJob(device.id, req.user?.sub || null, device.tenantId || null, netboxConfig);
    res.json({ jobId: job.id, queue: 'credential-check' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Connectivity test (TCP check)
app.post('/devices/:id/connectivity', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }
    const target = req.body?.target || device.ipAddress;
    const port = req.body?.port || device.sshPort || 22;
    const job = await addConnectivityTestJob(device.id, target, port, req.user?.sub || null, device.tenantId || null);
    res.json({ jobId: job.id, queue: 'connectivity-test' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Backup / Oxidized integration endpoints
app.get('/backup/devices', requireAuth, async (req, res) => {
  const where = buildDeviceWhere(req);
  const devices = await prisma.device.findMany({ where, orderBy: { id: 'desc' } });
  const nodesResp = await fetchOxidizedNodes();
  const versionsResp = await getLatestOxidizedVersionTimes(devices.map((d) => d.name));
  if (versionsResp?.ok === false) {
    console.warn('[BACKUP] Não foi possível obter última versão do Oxidized:', versionsResp?.error);
  }
  const lastVersions = versionsResp?.versions || new Map();
  const nodesMap = new Map();
  if (nodesResp?.nodes) {
    for (const node of nodesResp.nodes) {
      nodesMap.set(node.name, node);
    }
  }
  const managed = await getManagedRouterEntries();
  const routerDbInfo = getRouterDbStatus();
  const items = devices.map((device) => {
    const node = nodesMap.get(device.name);
    const hasPassword = !!device.credPasswordEnc;
    const oxidized = node
      ? {
        present: true,
        status: node.status || node.last?.status || 'unknown',
        lastRun: node.time || node.last?.end || null,
        lastVersion: lastVersions.get(device.name) || null,
      }
      : {
        present: false,
        status: device.backupEnabled ? 'pending' : 'inactive',
        lastRun: null,
        lastVersion: lastVersions.get(device.name) || null,
      };
    return {
      id: device.id,
      name: device.name,
      ipAddress: device.ipAddress,
      manufacturer: device.manufacturer,
      model: device.model,
      backupEnabled: !!device.backupEnabled,
      sshPort: device.sshPort || null,
      credUsername: device.credUsername || null,
      hasCredPassword: hasPassword,
      oxidized,
      managed: managed.names?.has(device.name) || false,
      tenantId: device.tenantId,
    };
  });
  res.json({
    items,
    oxidized: {
      available: !!nodesResp?.ok,
      message: nodesResp?.error || null,
      baseUrl: nodesResp?.baseUrl || null,
    },
    routerDb: routerDbInfo,
  });
});

app.post('/backup/routerdb/sync', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin'
      ? (req.body?.tenantId ? Number(req.body.tenantId) : null)
      : (req.user.tenantId || null);
    const job = await addOxidizedSyncJob(tenantId, req.user?.sub || null);
    res.json({ jobId: job.id, queue: 'oxidized-sync' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch('/backup/devices/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const enabled = req.body?.enabled;
  const sshPort = req.body?.sshPort;
  if (enabled === undefined && sshPort === undefined) {
    return res.status(400).json({ error: 'enabled ou sshPort devem ser informados' });
  }
  const data = {};
  if (enabled !== undefined) data.backupEnabled = !!enabled;
  if (sshPort !== undefined) {
    if (sshPort === null || sshPort === '') {
      data.sshPort = null;
    } else {
      const portNumber = Number(sshPort);
      if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
        return res.status(400).json({ error: 'sshPort inválida' });
      }
      data.sshPort = portNumber;
    }
  }
  if (data.backupEnabled) {
    if (!device.credUsername || !device.credPasswordEnc) {
      return res.status(400).json({ error: 'Configure usuário e senha antes de habilitar backup' });
    }
  }
  const updated = await prisma.device.update({ where: { id }, data });
  await syncRouterDbFromDb();
  res.json(sanitizeDeviceOutput(updated));
});

app.get('/backup/devices/:id/versions', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const resp = await fetchOxidizedVersions(device.name);
    if (!resp?.ok) {
      return res.status(502).json({ error: resp?.error || 'Oxidized indisponível' });
    }
    res.json(resp.versions || []);
  } catch (e) {
    console.error('[BACKUP][ERROR] Failed to fetch versions:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Oxidized HTTP Source Endpoint
app.get('/oxidized/nodes', async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      where: { backupEnabled: true },
      select: {
        name: true,
        ipAddress: true,
        platform: true,
        model: true,
        manufacturer: true,
        credUsername: true,
        credPasswordEnc: true,
        sshPort: true,
        tenant: { select: { name: true, tenantGroup: true } }
      }
    });

    const nodes = devices.map(d => {
      const group = d.tenant?.tenantGroup || d.tenant?.name || 'default';
      return {
        name: d.name,
        ip: d.ipAddress,
        model: d.platform || 'routeros', // Use platform (driver) or default to routeros
        group: group,
        username: d.credUsername,
        password: d.credPasswordEnc ? decryptSecret(d.credPasswordEnc) : null,
        ssh_port: d.sshPort || 22
      };
    });

    res.json(nodes);
  } catch (e) {
    console.error('[OXIDIZED][ERROR] Failed to serve nodes:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Applications
app.get("/applications", requireAuth, async (req, res) => {
  const where = req.user.tenantId ? { tenantId: req.user.tenantId } : {};
  const list = await prisma.application.findMany({ where, orderBy: { id: "desc" } });
  res.json(list);
});

app.post("/applications", requireAuth, async (req, res) => {
  const tenantId =
    req.user.tenantId ||
    (await prisma.tenant.upsert({ where: { name: "default" }, update: {}, create: { name: "default" } })).id;

  const { name, url, apiKey, status = "disconnected", description = null, config = null, username, password, privateKey } = req.body || {};
  if (!name || !url || !apiKey) return res.status(400).json({ error: "name, url, apiKey required" });

  // Handle Private Key
  if (privateKey) {
    try {
      const keyPath = path.join(__dirname, 'netbox_private_key.pem');
      await fs.writeFile(keyPath, privateKey, 'utf8');
      // Set permissions to 600
      await fs.chmod(keyPath, 0o600);
    } catch (e) {
      console.error("Failed to save private key:", e);
    }
  }

  // Prepare config with credentials
  let configObj = {};
  if (config) {
    try {
      configObj = typeof config === 'string' ? JSON.parse(config) : config;
    } catch {
      return res.status(400).json({ error: "config must be valid JSON" });
    }
  }
  if (username) configObj.username = username;
  if (password) configObj.password = password;

  const configStr = JSON.stringify(configObj);

  const created = await prisma.application.create({
    data: { tenantId, name, url, apiKey, status, description, config: configStr },
  });
  res.status(201).json(created);
});

app.patch("/applications/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const appRow = await prisma.application.findUnique({ where: { id } });
  if (!appRow || (req.user.tenantId && appRow.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  const body = req.body || {};
  const data = {};

  // Allow updating specific fields
  const allowed = ['name', 'url', 'apiKey', 'status', 'description', 'config'];

  // Handle Private Key separately
  if (body.privateKey) {
    try {
      const keyPath = path.join(__dirname, 'netbox_private_key.pem');
      await fs.writeFile(keyPath, body.privateKey, 'utf8');
      await fs.chmod(keyPath, 0o600);
    } catch (e) {
      console.error("Failed to save private key:", e);
    }
  }

  // Handle Credentials in Config
  if (body.username !== undefined || body.password !== undefined) {
    let currentConfig = {};
    try {
      if (appRow.config) currentConfig = JSON.parse(appRow.config);
    } catch { }

    if (body.username !== undefined) currentConfig.username = body.username;
    if (body.password !== undefined) currentConfig.password = body.password;

    data.config = JSON.stringify(currentConfig);
  }

  for (const k of allowed) {
    if (body[k] !== undefined) {
      if (k === 'config' && body[k] !== null) {
        // Validate config JSON if explicitly passed
        try {
          const c = typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]);
          JSON.parse(c);
          data.config = c;
        } catch {
          return res.status(400).json({ error: "config must be valid JSON" });
        }
      } else if (k !== 'config') { // Skip config here as we handled it or will handle it via merge
        data[k] = body[k];
      }
    }
  }

  const updated = await prisma.application.update({ where: { id }, data });
  res.json(updated);
});

// ========== OXIDIZED PROXY ROUTES ==========

// Listar proxies do tenant
app.get("/oxidized-proxy", requireAuth, async (req, res) => {
  const where = req.user.tenantId ? { tenantId: req.user.tenantId } : {};
  const proxies = await prisma.oxidizedProxy.findMany({
    where,
    include: {
      _count: {
        select: { devices: true }
      }
    },
    orderBy: { id: "desc" }
  });
  res.json(proxies);
});

// Criar proxy
app.post("/oxidized-proxy", requireAuth, async (req, res) => {
  const tenantId =
    req.user.tenantId ||
    (await prisma.tenant.upsert({ where: { name: "default" }, update: {}, create: { name: "default" } })).id;

  const { name, siteId, gitRepoUrl = null } = req.body || {};
  if (!name || !siteId) return res.status(400).json({ error: "name and siteId required" });

  // Gerar API key única
  const crypto = await import("crypto");
  const apiKey = crypto.randomBytes(32).toString("hex");

  try {
    const proxy = await prisma.oxidizedProxy.create({
      data: { name, siteId, gitRepoUrl, apiKey, tenantId }
    });
    res.status(201).json(proxy);
  } catch (e) {
    if (e.code === "P2002") {
      return res.status(409).json({ error: "Site ID já existe" });
    }
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Atualizar proxy
app.patch("/oxidized-proxy/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proxy = await prisma.oxidizedProxy.findUnique({ where: { id } });
  if (!proxy || (req.user.tenantId && proxy.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  const { interval } = req.body || {};
  const data = {};

  if (interval !== undefined) {
    const intervalNum = Number(interval);
    if (!Number.isFinite(intervalNum) || intervalNum < 300 || intervalNum > 86400) {
      return res.status(400).json({ error: "Interval must be between 300 (5 min) and 86400 (24h) seconds" });
    }
    data.interval = intervalNum;
  }

  const updated = await prisma.oxidizedProxy.update({ where: { id }, data });
  res.json(updated);
});

// Deletar proxy
app.delete("/oxidized-proxy/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proxy = await prisma.oxidizedProxy.findUnique({ where: { id } });
  if (!proxy || (req.user.tenantId && proxy.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  await prisma.oxidizedProxy.delete({ where: { id } });
  res.json({ success: true });
});

// Gerar script de deploy
app.get("/oxidized-proxy/:id/deploy-script", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proxy = await prisma.oxidizedProxy.findUnique({ where: { id } });
  if (!proxy || (req.user.tenantId && proxy.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  const centralUrl = process.env.APP_URL || `http://${req.headers.host}`;
  const script = `#!/bin/bash
curl -sSL ${centralUrl}/oxidized-proxy/install.sh | bash -s -- \\
  "${proxy.siteId}" \\
  "${centralUrl}" \\
  "${proxy.apiKey}" \\
  "${proxy.gitRepoUrl || ''}"`;

  res.type("text/plain").send(script);
});

// === ENDPOINTS PARA O PROXY REMOTO (autenticação via API Key) ===

// Middleware de autenticação para proxies
async function proxyAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const siteId = req.params.siteId;
  if (!apiKey || !siteId) return res.status(401).json({ error: "Unauthorized" });

  const proxy = await prisma.oxidizedProxy.findFirst({ where: { siteId, apiKey } });
  if (!proxy) return res.status(401).json({ error: "Unauthorized" });

  req.proxy = proxy;
  next();
}

// Mapeamento de plataformas NetBox para Oxidized
function mapPlatformToOxidized(platform) {
  const map = {
    "mikrotik-routeros": "routeros",
    "huawei-vrp": "vrp",
    "cisco-ios": "ios",
    "cisco-iosxe": "iosxe",
    "juniper-junos": "junos",
    "fortinet-fortios": "fortios"
  };
  return map[platform] || "ios";
}

// Função para notificar proxies Oxidized sobre mudanças
async function notifyOxidizedProxies(deviceId, action = 'reload') {
  try {
    const device = await prisma.device.findUnique({
      where: { id: Number(deviceId) },
      include: { oxidizedProxy: true }
    });

    if (!device) {
      console.warn('[OXIDIZED] Device not found:', deviceId);
      return { success: false, error: 'Device not found' };
    }

    // Se o dispositivo tem proxy específico, notifica apenas ele
    // Se não tem, notifica todos os proxies do tenant (caso use proxy central)
    const proxiesToNotify = device.oxidizedProxyId
      ? [device.oxidizedProxy]
      : await prisma.oxidizedProxy.findMany({
        where: { tenantId: device.tenantId, status: 'active' }
      });

    const results = [];

    for (const proxy of proxiesToNotify.filter(p => p && p.endpoint)) {
      try {
        // Notificar o proxy para recarregar configuração
        const reloadUrl = `${proxy.endpoint}/reload`;
        const reloadRes = await fetch(reloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000)
        }).catch(err => {
          console.warn(`[OXIDIZED] Failed to reload proxy ${proxy.name}:`, err.message);
          return null;
        });

        // Se for update ou delete, também força backup imediato do dispositivo
        if (action === 'update' && device.name) {
          const nextUrl = `${proxy.endpoint}/node/next/${encodeURIComponent(device.name)}`;
          await fetch(nextUrl, {
            method: 'POST',
            signal: AbortSignal.timeout(5000)
          }).catch(err => {
            console.warn(`[OXIDIZED] Failed to trigger backup for ${device.name}:`, err.message);
          });
        }

        results.push({
          proxyId: proxy.id,
          proxyName: proxy.name,
          success: !!reloadRes,
          action
        });

        console.log(`[OXIDIZED] Notified proxy ${proxy.name} (${proxy.endpoint}) - Action: ${action}`);
      } catch (err) {
        console.warn(`[OXIDIZED] Error notifying proxy ${proxy.name}:`, err.message);
        results.push({
          proxyId: proxy.id,
          proxyName: proxy.name,
          success: false,
          error: err.message
        });
      }
    }

    return { success: true, results };
  } catch (err) {
    console.error('[OXIDIZED] Error in notifyOxidizedProxies:', err);
    return { success: false, error: err.message };
  }
}

// Lista de dispositivos para o proxy coletar
app.get("/api/v1/oxidized-proxy/:siteId/devices", proxyAuth, async (req, res) => {
  const devices = await prisma.device.findMany({
    where: {
      tenantId: req.proxy.tenantId,
      oxidizedProxyId: req.proxy.id
    }
  });

  const oxidizedFormat = devices.map(d => ({
    name: d.name,
    ip: d.ipAddress,
    model: mapPlatformToOxidized(d.platform),
    username: d.credUsername || "admin",
    password: d.credPasswordEnc ? decryptSecret(d.credPasswordEnc) : "",
    enable: "",
    vars: { tenant: req.proxy.tenantId, site: d.site || "" }
  }));

  res.json(oxidizedFormat);
});

// Registro do proxy (chamado pelo script de deploy)
app.post("/api/v1/oxidized-proxy/register", async (req, res) => {
  const { site_id, endpoint } = req.body || {};
  const apiKey = req.headers["x-api-key"];

  if (!site_id || !apiKey || !endpoint) {
    return res.status(400).json({ error: "site_id, endpoint and x-api-key required" });
  }

  const result = await prisma.oxidizedProxy.updateMany({
    where: { siteId: site_id, apiKey },
    data: { endpoint, status: "active", lastSeen: new Date() }
  });

  if (result.count === 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.json({ success: true });
});

// Recebe status de backup
app.post("/api/v1/oxidized-proxy/:siteId/status", proxyAuth, async (req, res) => {
  const { event, node, status, message } = req.body || {};

  await prisma.oxidizedProxyLog.create({
    data: {
      proxyId: req.proxy.id,
      event: event || "unknown",
      device: node || null,
      message: message || null
    }
  });

  await prisma.oxidizedProxy.update({
    where: { id: req.proxy.id },
    data: { lastSeen: new Date() }
  });

  res.json({ success: true });
});

// Endpoint manual para forçar sincronização de um proxy
app.post("/oxidized-proxy/:id/sync", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proxy = await prisma.oxidizedProxy.findUnique({ where: { id } });

  if (!proxy || (req.user.tenantId && proxy.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }

  if (!proxy.endpoint) {
    return res.status(400).json({ error: "Proxy não tem endpoint configurado" });
  }

  try {
    // Forçar reload do proxy
    const reloadUrl = `${proxy.endpoint}/reload`;
    const reloadRes = await fetch(reloadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!reloadRes.ok) {
      throw new Error(`Proxy retornou status ${reloadRes.status}`);
    }

    res.json({
      success: true,
      message: `Proxy ${proxy.name} sincronizado com sucesso`,
      endpoint: proxy.endpoint
    });
  } catch (err) {
    res.status(500).json({
      error: `Falha ao sincronizar proxy: ${err.message}`,
      endpoint: proxy.endpoint
    });
  }
});

// Endpoint para sincronizar todos os proxies de um tenant
app.post("/oxidized-proxy/sync-all", requireAuth, async (req, res) => {
  const tenantId = req.user.tenantId;
  const where = tenantId ? { tenantId, status: 'active' } : { status: 'active' };

  const proxies = await prisma.oxidizedProxy.findMany({
    where,
    select: { id: true, name: true, endpoint: true }
  });

  const results = [];

  for (const proxy of proxies.filter(p => p.endpoint)) {
    try {
      const reloadUrl = `${proxy.endpoint}/reload`;
      const reloadRes = await fetch(reloadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      results.push({
        proxyId: proxy.id,
        proxyName: proxy.name,
        success: reloadRes.ok,
        status: reloadRes.status
      });
    } catch (err) {
      results.push({
        proxyId: proxy.id,
        proxyName: proxy.name,
        success: false,
        error: err.message
      });
    }
  }

  const successCount = results.filter(r => r.success).length;

  res.json({
    success: successCount > 0,
    total: results.length,
    synced: successCount,
    results
  });
});

// Endpoint para buscar logs de backup de um dispositivo
app.get("/devices/:id/backup-logs", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const limit = Number(req.query.limit) || 100;

  try {
    const device = await prisma.device.findUnique({
      where: { id },
      include: { oxidizedProxy: true }
    });

    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Buscar logs do proxy associado ao dispositivo
    const logs = await prisma.oxidizedProxyLog.findMany({
      where: {
        device: device.name,
        proxy: device.oxidizedProxyId ? {
          id: device.oxidizedProxyId
        } : {
          tenantId: device.tenantId
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        proxy: {
          select: { name: true, endpoint: true }
        }
      }
    });

    // Se houver proxy com endpoint, buscar também do Oxidized
    let oxidizedLogs = [];
    if (device.oxidizedProxy?.endpoint) {
      try {
        const oxidizedUrl = `${device.oxidizedProxy.endpoint}/node/stats/${encodeURIComponent(device.name)}`;
        const oxidizedRes = await fetch(oxidizedUrl, {
          signal: AbortSignal.timeout(5000)
        }).catch(() => null);

        if (oxidizedRes && oxidizedRes.ok) {
          const data = await oxidizedRes.json();
          oxidizedLogs = data.history || [];
        }
      } catch (err) {
        console.warn('[BACKUP-LOGS] Failed to fetch from Oxidized:', err.message);
      }
    }

    res.json({
      device: {
        id: device.id,
        name: device.name,
        ipAddress: device.ipAddress
      },
      logs: logs.map(log => ({
        id: log.id,
        event: log.event,
        message: log.message,
        timestamp: log.createdAt,
        proxyName: log.proxy?.name,
        success: log.event?.includes('success'),
        hasChange: log.message?.toLowerCase().includes('change') || log.message?.toLowerCase().includes('diff')
      })),
      oxidizedLogs,
      total: logs.length
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Allow user to change password when flagged for reset
app.post("/auth/change-password", async (req, res) => {
  const { email, username, identifier, currentPassword, newPassword } = req.body || {};
  const ident = email || username || identifier;
  if (!ident || !currentPassword || !newPassword) return res.status(400).json({ error: "identifier, currentPassword, newPassword required" });
  let user = await prisma.user.findUnique({ where: { email: ident } }).catch(() => null);
  if (!user) {
    user = await prisma.user.findFirst({ where: { username: ident } }).catch(() => null);
  }
  if (!user || !user.isActive) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const hash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, mustResetPassword: false } });
  const token = signToken(updated);
  res.json({ ok: true, token });
});

// Current user profile
app.get('/me', requireAuth, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: Number(req.user.sub) } });
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ id: u.id, email: u.email, username: u.username, role: u.role, isActive: u.isActive, tenantId: u.tenantId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Update current user profile (limited fields)
app.patch('/me', requireAuth, async (req, res) => {
  try {
    const { username } = req.body || {};
    const data = {};
    if (typeof username === 'string' && username.trim().length > 0) data.username = username.trim();
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'No changes' });
    const updated = await prisma.user.update({ where: { id: Number(req.user.sub) }, data });
    res.json({ id: updated.id, email: updated.email, username: updated.username, role: updated.role, isActive: updated.isActive, tenantId: updated.tenantId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Persistência de descobertas SNMP: Interfaces
app.get("/devices/:id/discovery/interfaces", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const rows = await prisma.discoveredInterface.findMany({
    where: { deviceId: id },
    orderBy: { ifIndex: "asc" },
  });
  res.json(rows);
});

app.post("/devices/:id/discovery/interfaces", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const { interfaces } = req.body || {};
  if (!Array.isArray(interfaces)) {
    return res.status(400).json({ error: "'interfaces' must be an array" });
  }
  // Substitui snapshot anterior
  await prisma.discoveredInterface.deleteMany({ where: { deviceId: id } });
  if (interfaces.length > 0) {
    await prisma.discoveredInterface.createMany({
      data: interfaces.map((it) => ({
        tenantId: device.tenantId,
        deviceId: device.id,
        deviceName: device.name,
        ifIndex: String(it.index ?? it.ifIndex ?? ""),
        ifName: String(it.name ?? it.ifName ?? ""),
        ifDesc: (it.desc ?? it.ifDesc ?? "") || null,
        ifType: Number(it.type ?? it.ifType ?? 0),
      })),
    });
  }
  const count = await prisma.discoveredInterface.count({ where: { deviceId: id } });
  res.json({ ok: true, count });
});

// Persistência de descobertas SNMP: BGP Peers
app.get("/devices/:id/discovery/peers", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const rows = await prisma.discoveredBgpPeer.findMany({
    where: { deviceId: id },
    orderBy: [{ vrfName: "asc" }, { ipPeer: "asc" }],
  });
  res.json(rows);
});

app.post("/devices/:id/discovery/peers", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
    return res.status(404).json({ error: "Not found" });
  }
  const { peers, localAsn } = req.body || {};
  if (!Array.isArray(peers)) {
    return res.status(400).json({ error: "'peers' must be an array" });
  }
  await prisma.discoveredBgpPeer.deleteMany({ where: { deviceId: id } });
  if (peers.length > 0) {
    const asns = Array.from(new Set(peers.map((p) => Number(p.asn || 0)).filter((n) => Number.isFinite(n) && n > 0)));
    const reg = await prisma.asnRegistry.findMany({ where: { asn: { in: asns } } });
    const map = new Map(reg.map(r => [Number(r.asn), r.name]));
    await prisma.discoveredBgpPeer.createMany({
      data: peers.map((p) => {
        const asn = Number(p.asn ?? 0) || 0;
        const fallback = asn ? `AS${asn}` : null;
        const regName = map.get(asn) || null;
        const effName = regName || (p.name ?? null) || fallback;
        return {
          tenantId: device.tenantId,
          deviceId: device.id,
          deviceName: device.name,
          ipPeer: String(p.ip ?? p.ip_peer ?? p.peerIp ?? ""),
          asn,
          asnName: effName,
          localAsn: Number(localAsn || 0) || null,
          name: (p.name ?? null) || null,
          vrfName: (p.vrf_name ?? p.vrfName ?? null) || null,
        };
      }),
    });
  }
  const count = await prisma.discoveredBgpPeer.count({ where: { deviceId: id } });
  res.json({ ok: true, count });
});

// Remote access sessions
app.post('/access/sessions', requireAuth, async (req, res) => {
  try {
    const deviceId = Number(req.body?.deviceId);
    if (!Number.isFinite(deviceId)) return res.status(400).json({ error: 'deviceId inválido' });
    const session = await createSshSession({ prisma, deviceId, user: req.user });
    await logAudit(req, 'access-session-create', { deviceId, sessionId: session.id });
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/access/sessions', requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const tenantScope = req.user.role === 'admin'
      ? (req.query.tenantId ? Number(req.query.tenantId) : null)
      : (req.user.tenantId || null);
    const sessions = await listSshSessions({ prisma, tenantId: tenantScope, limit });
    const sanitized = sessions.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      deviceIp: row.deviceIp,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationMs: row.durationMs,
      tenantId: row.tenantId,
      user: row.user ? { id: row.user.id, email: row.user.email, username: row.user.username } : null,
      canReplay: !!row.logPath,
    }));
    res.json(sanitized);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/access/sessions/:id/log', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await getSessionLog({
      prisma,
      sessionId: id,
      tenantId: req.user.tenantId || null,
      userId: req.user?.sub ? Number(req.user.sub) : null,
      isAdmin: req.user.role === 'admin',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.ws('/access/sessions/:id/stream', async (ws, req) => {
  try {
    const tokenParam = req.query.token;
    const keyParam = req.query.key;
    const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam || req.headers.authorization?.split(' ')[1] || null;
    const sessionKey = Array.isArray(keyParam) ? keyParam[0] : keyParam;
    if (!token || !sessionKey) {
      ws.close(1008, 'Token e key obrigatórios');
      return;
    }
    let userPayload = null;
    try {
      userPayload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      ws.close(1008, 'Token inválido');
      return;
    }
    const sessionId = Number(req.params.id);
    await handleSshWebsocket({
      prisma,
      sessionId,
      sessionKey,
      ws,
      user: userPayload,
    });
  } catch (e) {
    ws.close(1011, e?.message || 'Erro inesperado');
  }
});

// Jumpserver endpoints
// Get Jumpserver configuration (only if application is registered)
app.get('/access/jumpserver/config', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.query.tenantId
      ? Number(req.query.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const config = await prisma.application.findFirst({
      where: {
        tenantId,
        name: 'Jumpserver',
      },
    });

    if (!config) {
      return res.json({ configured: false });
    }

    // Parse config JSON if exists
    let parsedConfig = {};
    if (config.config) {
      try {
        parsedConfig = JSON.parse(config.config);
      } catch { }
    }

    res.json({
      configured: true,
      url: config.url,
      status: config.status,
      organizationId: parsedConfig.organizationId || null,
      defaultSystemUser: parsedConfig.defaultSystemUser || null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Get assets from Jumpserver
app.get('/access/jumpserver/assets', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.query.tenantId
      ? Number(req.query.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const client = await createJumpserverClientFromConfig(prisma, tenantId);
    if (!client) {
      return res.status(404).json({ error: 'Jumpserver não configurado' });
    }

    const assets = await client.getAssets({
      limit: Number(req.query.limit) || 100,
      search: req.query.search || '',
    });

    res.json(assets);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Get system users from Jumpserver
app.get('/access/jumpserver/system-users', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.query.tenantId
      ? Number(req.query.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const client = await createJumpserverClientFromConfig(prisma, tenantId);
    if (!client) {
      return res.status(404).json({ error: 'Jumpserver não configurado' });
    }

    const systemUsers = await client.getSystemUsers({
      limit: Number(req.query.limit) || 100,
    });

    res.json(systemUsers);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// List sessions from Jumpserver
app.get('/access/jumpserver/sessions', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.query.tenantId
      ? Number(req.query.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const client = await createJumpserverClientFromConfig(prisma, tenantId);
    if (!client) {
      return res.status(404).json({ error: 'Jumpserver não configurado' });
    }

    const sessions = await client.listSessions({
      limit: Number(req.query.limit) || 50,
      assetId: req.query.assetId || undefined,
    });

    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Get session replay from Jumpserver
app.get('/access/jumpserver/sessions/:sessionId/replay', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.query.tenantId
      ? Number(req.query.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const client = await createJumpserverClientFromConfig(prisma, tenantId);
    if (!client) {
      return res.status(404).json({ error: 'Jumpserver não configurado' });
    }

    const sessionId = req.params.sessionId;
    const replay = await client.getSessionReplay(sessionId);

    res.json(replay);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Sync devices with Jumpserver assets (batch update jumpserverAssetId)
app.post('/access/jumpserver/sync-devices', requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.role === 'admin' && req.body.tenantId
      ? Number(req.body.tenantId)
      : (req.user.tenantId || null);

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID obrigatório' });
    }

    const client = await createJumpserverClientFromConfig(prisma, tenantId);
    if (!client) {
      return res.status(404).json({ error: 'Jumpserver não configurado' });
    }

    // Get all assets from Jumpserver
    const assets = await client.getAssets({ limit: 1000 });

    // Get all devices from this tenant
    const devices = await prisma.device.findMany({ where: { tenantId } });

    // Match by IP address
    let matchedCount = 0;
    for (const device of devices) {
      const asset = assets.find(a => a.ip === device.ipAddress || a.address === device.ipAddress);
      if (asset) {
        await prisma.device.update({
          where: { id: device.id },
          data: { jumpserverAssetId: asset.id },
        });
        matchedCount++;
      }
    }

    res.json({
      ok: true,
      matched: matchedCount,
      totalDevices: devices.length,
      totalAssets: assets.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Test Jumpserver connection
app.post('/access/jumpserver/test', requireAuth, async (req, res) => {
  try {
    const { url, apiKey, organizationId } = req.body || {};

    if (!url || !apiKey) {
      return res.status(400).json({ error: 'URL e API Key obrigatórios' });
    }

    const client = new JumpserverClient({
      baseUrl: url,
      apiToken: apiKey,
      organizationId: organizationId || null,
    });

    const result = await client.authenticate();

    res.json({
      ok: true,
      connected: true,
      user: result.user,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      connected: false,
      error: String(e?.message || e),
    });
  }
});

const KNOWN_QUEUE_NAMES = new Set(QUEUE_NAMES || []);

app.ws('/ws/jobs', (ws, req) => {
  try {
    const tokenParam = req.query.token;
    const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam || req.headers.authorization?.split(' ')[1] || null;
    if (!token) {
      ws.close(1008, 'Token obrigatório');
      return;
    }

    let userPayload = null;
    try {
      userPayload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      ws.close(1008, 'Token inválido');
      return;
    }

    const queueParam = req.query.queues;
    const queueList = Array.isArray(queueParam) ? queueParam : (queueParam ? String(queueParam).split(',') : []);
    const queues = queueList.map((q) => String(q).trim()).filter((q) => q && KNOWN_QUEUE_NAMES.has(q));
    const jobId = req.query.jobId ? String(req.query.jobId) : null;

    const subscription = subscribeJobEvents(ws, { queues, jobId });
    try {
      ws.send(JSON.stringify({
        event: 'subscribed',
        queues: Array.from(subscription.queues.values()),
        jobId: subscription.jobId,
        user: { id: userPayload?.sub || null, tenantId: userPayload?.tenantId || null },
      }));
    } catch { }

    ws.on('close', () => unsubscribeJobEvents(ws));
    ws.on('error', () => unsubscribeJobEvents(ws));
  } catch (err) {
    ws.close(1011, err?.message || 'Erro inesperado');
  }
});

app.get('/queues/:queue/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const queue = String(req.params.queue);
    if (!KNOWN_QUEUE_NAMES.has(queue)) return res.status(400).json({ error: 'Fila desconhecida' });
    const jobId = decodeURIComponent(req.params.jobId);
    const job = await getJobStatus(queue, jobId);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/queues/:queue/jobs', requireAuth, async (req, res) => {
  try {
    const queue = String(req.params.queue);
    if (!KNOWN_QUEUE_NAMES.has(queue)) return res.status(400).json({ error: 'Fila desconhecida' });
    const status = String(req.query.status || 'active');
    const start = Number(req.query.start) || 0;
    const end = Number(req.query.end) || 10;
    const jobs = await getQueueJobs(queue, status, start, end);
    res.json(jobs);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Queue overview - status de todas as filas
app.get('/queues/overview', requireAuth, async (req, res) => {
  try {
    const queueMap = getAllQueues();
    const overview = [];

    for (const [queueName, queue] of queueMap.entries()) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      overview.push({
        name: queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      });
    }

    res.json({ queues: overview });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Lista peers BGP descobertos por tenant (escopo do usuário ou por query ?tenantId=)
app.get('/bgp/peers', requireAuth, async (req, res) => {
  try {
    let where = {};
    if (req.user.tenantId) {
      where = { tenantId: req.user.tenantId };
    } else if (req.query.tenantId) {
      const tid = Number(req.query.tenantId);
      if (Number.isFinite(tid)) where = { tenantId: tid };
    }
    const rows = await prisma.discoveredBgpPeer.findMany({ where, orderBy: [{ deviceName: 'asc' }, { ipPeer: 'asc' }] });
    const uniqAsn = Array.from(new Set(rows.map((r) => Number(r.asn || 0)).filter((n) => Number.isFinite(n) && n > 0)));
    const reg = uniqAsn.length
      ? await prisma.asnRegistry.findMany({ where: { asn: { in: uniqAsn } } })
      : [];
    const regMap = new Map(reg.map((r) => [Number(r.asn), r.name || null]));
    res.json(rows.map((r) => {
      const regName = regMap.get(Number(r.asn)) || null;
      const effName = regName || r.asnName || r.name || (r.asn ? `AS${r.asn}` : null);
      return { id: r.id, tenantId: r.tenantId, deviceId: r.deviceId, deviceName: r.deviceName, ip: r.ipPeer, asn: r.asn, localAsn: r.localAsn || null, name: effName, vrfName: r.vrfName || null };
    }));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ASN registry endpoints (admin can upsert, users can list)
app.get('/asn-registry', requireAuth, async (_req, res) => {
  try {
    const list = await prisma.asnRegistry.findMany({ orderBy: { asn: 'asc' } });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/asn-registry', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { asn, name } = req.body || {};
    if (!asn || !name) return res.status(400).json({ error: 'asn and name required' });
    const up = await prisma.asnRegistry.upsert({ where: { asn: Number(asn) }, update: { name }, create: { asn: Number(asn), name } });
    res.json(up);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/asn-registry/reprocess', requireAuth, requireAdmin, async (_req, res) => {
  try {
    await refreshAsnRegistryFromPeers();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/backup/content', requireAuth, async (req, res) => {
  try {
    const { node, oid } = req.query;
    if (!node || !oid) {
      return res.status(400).json({ error: 'Missing node or oid' });
    }
    const result = await getOxidizedContent(node, oid);
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ content: result.content, path: result.path || null, paths: result.paths || [], repo: result.repo || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/backup/diff', requireAuth, async (req, res) => {
  try {
    const { node, oid1, oid2 } = req.query;
    if (!node || !oid1 || !oid2) {
      return res.status(400).json({ error: 'Missing node, oid1, or oid2' });
    }
    const result = await getOxidizedDiff(node, oid1, oid2);
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ diff: result.diff, path: result.path || null, paths: result.paths || [], repo: result.repo || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NetBox sync
app.post("/netbox/sync", requireAuth, async (req, res) => {
  try {
    const { resources, url: urlOverride, token: tokenOverride, deviceFilters } = req.body || {};

    // Fetch Application config to get default credentials
    // We assume the URL matches the one in the DB, or we find the first NetBox app
    let defaultCredentials = {};
    const app = await prisma.application.findFirst({
      where: {
        OR: [
          { url: urlOverride },
          { name: { contains: 'NetBox' } }
        ]
      }
    });

    if (app && app.config) {
      try {
        const conf = JSON.parse(app.config);
        defaultCredentials = { username: conf.username, password: conf.password };
      } catch { }
    }

    const job = await addNetboxSyncJob({
      resources: resources && resources.length ? resources : ['tenants', 'devices'],
      url: urlOverride || process.env.NETBOX_URL,
      token: tokenOverride || process.env.NETBOX_TOKEN,
      deviceFilters: deviceFilters || null,
      defaultCredentials,
    }, req.user?.sub || null, req.user?.tenantId || null);

    res.json({
      jobId: job.id,
      queue: 'netbox-sync',
      enqueuedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Jumpserver Integration
app.post("/jumpserver/test", requireAuth, async (req, res) => {
  try {
    const { url, apiKey } = req.body || {};
    if (!url || !apiKey) return res.status(400).json({ error: "URL and API Key required" });
    const result = await testJumpserverConnection(url, apiKey);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/jumpserver/connect/:deviceId", requireAuth, async (req, res) => {
  try {
    const deviceId = Number(req.params.deviceId);
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || (req.user.tenantId && device.tenantId !== req.user.tenantId)) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Find Jumpserver application config
    // We assume there is one Jumpserver app configured per tenant (or global)
    const whereApp = {
      name: { contains: "Jumpserver" }, // Simple heuristic
      ...(req.user.tenantId ? { tenantId: req.user.tenantId } : {}),
    };

    // If no tenant specific, try global default tenant if user is admin? 
    // For now, strict tenant check or fallback to any if no tenantId on user

    const appConfig = await prisma.application.findFirst({
      where: whereApp,
    });

    if (!appConfig) {
      return res.status(404).json({ error: "Jumpserver integration not configured in Applications" });
    }

    if (!device.ipAddress) {
      return res.status(400).json({ error: "Device has no IP address" });
    }

    const asset = await findAssetByIp(appConfig.url, appConfig.apiKey, device.ipAddress);
    if (!asset) {
      return res.status(404).json({ error: `Asset with IP ${device.ipAddress} not found in Jumpserver` });
    }

    const connectUrl = await getConnectUrl(appConfig.url, appConfig.apiKey, asset);
    res.json({ url: connectUrl });

  } catch (e) {
    console.error("[Jumpserver] Connect error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});



// NetBox catalog (device roles, platforms, ...)
app.post("/netbox/catalog", requireAuth, async (req, res) => {
  try {
    const { url: urlOverride, token: tokenOverride, resources } = req.body || {};
    const out = await getNetboxCatalog({
      url: urlOverride || process.env.NETBOX_URL,
      token: tokenOverride || process.env.NETBOX_TOKEN,
      resources: resources || [],
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Stats overview (contadores para Dashboard)
app.get("/stats/overview", requireAuth, async (req, res) => {
  try {
    let effectiveTenantId = req.user.tenantId || null;
    if (!effectiveTenantId && req.user.role === 'admin' && req.query.tenantId) {
      const tid = Number(req.query.tenantId);
      if (Number.isFinite(tid)) effectiveTenantId = tid;
    }
    const whereTenant = effectiveTenantId ? { tenantId: effectiveTenantId } : {};
    const GROUP_FILTER = process.env.NETBOX_TENANT_GROUP_FILTER || "K3G Solutions";
    const [activeDevices, discoveredPeers, tenants] = await Promise.all([
      prisma.device.count({ where: { ...whereTenant, status: "active" } }),
      prisma.discoveredBgpPeer.count({ where: whereTenant }),
      prisma.tenant.count({ where: { ...(effectiveTenantId ? { id: effectiveTenantId } : {}), tenantGroup: GROUP_FILTER } }),
    ]);
    res.json({ activeDevices, discoveredPeers, tenants });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/stats/host", requireAuth, async (_req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = totalMem > 0 ? Number(((usedMem / totalMem) * 100).toFixed(1)) : 0;
    const [load1m = 0] = os.loadavg();
    const cores = Array.isArray(os.cpus()) ? os.cpus().length : 1;
    const cpuPercent = Number(Math.min(100, (load1m / Math.max(cores, 1)) * 100).toFixed(1));
    res.json({
      cpu: {
        percent: isNaN(cpuPercent) ? 0 : cpuPercent,
        load1m: Number(load1m.toFixed(2)),
        cores,
      },
      memory: {
        percent: memPercent,
        total: totalMem,
        used: usedMem,
        free: freeMem,
      },
      uptimeSeconds: os.uptime(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Admin: summary of counts (scoped to tenant unless admin without tenant)
app.get("/admin/summary", requireAuth, async (req, res) => {
  try {
    let whereTenant = {};
    if (req.user.tenantId) {
      whereTenant = { tenantId: req.user.tenantId };
    } else {
      const def = await prisma.tenant.findUnique({ where: { name: "default" } });
      whereTenant = def ? { tenantId: def.id } : { tenantId: -1 };
    }
    const [devices, interfaces, peers, applications, tenants] = await Promise.all([
      prisma.device.count({ where: whereTenant }),
      prisma.discoveredInterface.count({ where: whereTenant }),
      prisma.discoveredBgpPeer.count({ where: whereTenant }),
      prisma.application.count({ where: whereTenant }),
      prisma.tenant.count({ where: req.user.tenantId ? { id: req.user.tenantId } : { name: "default" } }),
    ]);
    res.json({ devices, interfaces, peers, applications, tenants });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Admin: purge selected entities in tenant scope, or global if admin
app.post("/admin/purge", requireAuth, async (req, res) => {
  try {
    const { devices = false, discoveries = false, applications = false, tenants = false, confirm = "", dryRun = false, global = false } = req.body || {};
    if (typeof confirm !== "string" || confirm.toUpperCase() !== "APAGAR") {
      return res.status(400).json({ error: "Confirmação inválida. Digite 'APAGAR' para confirmar." });
    }
    if (tenants && req.user.role !== "admin") {
      return res.status(403).json({ error: "Somente admin pode remover tenants" });
    }
    if (global && req.user.role !== "admin") {
      return res.status(403).json({ error: "Somente admin pode executar purga global" });
    }

    let whereTenant = {};
    if (req.user.tenantId) {
      whereTenant = { tenantId: req.user.tenantId };
    } else if (req.user.role === 'admin') {
      // Admin sem tenant: assume global por padrão (alinha com a visualização)
      whereTenant = {};
    } else {
      // Usuário comum sem tenant (não deveria acontecer, mas fallback para default)
      const def = await prisma.tenant.findUnique({ where: { name: "default" } });
      whereTenant = def ? { tenantId: def.id } : { tenantId: -1 };
    }
    const result = { deletedDevices: 0, deletedInterfaces: 0, deletedPeers: 0, deletedApplications: 0, deletedTenants: 0 };

    if (dryRun) {
      if (discoveries) {
        result.deletedInterfaces = await prisma.discoveredInterface.count({ where: whereTenant });
        result.deletedPeers = await prisma.discoveredBgpPeer.count({ where: whereTenant });
      } else if (devices) {
        const scopedDevices = await prisma.device.findMany({ where: whereTenant, select: { id: true } });
        const ids = scopedDevices.map((d) => d.id);
        if (ids.length > 0) {
          result.deletedInterfaces = await prisma.discoveredInterface.count({ where: { deviceId: { in: ids } } });
          result.deletedPeers = await prisma.discoveredBgpPeer.count({ where: { deviceId: { in: ids } } });
        }
      }
      if (devices) {
        result.deletedDevices = await prisma.device.count({ where: whereTenant });
      }
      if (applications) {
        result.deletedApplications = await prisma.application.count({ where: whereTenant });
      }
      if (tenants && req.user.role === "admin") {
        result.deletedTenants = await prisma.tenant.count({});
      }
      await logAudit(req, 'purge-dryrun', { devices, discoveries, applications, tenants, global, result });
      return res.json({ ok: false, dryRun: true, ...result });
    }

    if (discoveries) {
      result.deletedInterfaces = (await prisma.discoveredInterface.deleteMany({ where: whereTenant })).count;
      result.deletedPeers = (await prisma.discoveredBgpPeer.deleteMany({ where: whereTenant })).count;
    }
    if (devices) {
      // Delete discoveries first for devices in scope
      const scopedDevices = await prisma.device.findMany({ where: whereTenant, select: { id: true } });
      const ids = scopedDevices.map((d) => d.id);
      if (ids.length > 0) {
        await prisma.discoveredInterface.deleteMany({ where: { deviceId: { in: ids } } });
        await prisma.discoveredBgpPeer.deleteMany({ where: { deviceId: { in: ids } } });
      }
      result.deletedDevices = (await prisma.device.deleteMany({ where: whereTenant })).count;
    }
    if (applications) {
      result.deletedApplications = (await prisma.application.deleteMany({ where: whereTenant })).count;
    }
    if (tenants) {
      // Admin-only: remove all tenants (dangerous)
      result.deletedTenants = (await prisma.tenant.deleteMany({})).count;
    }

    await logAudit(req, 'purge', { devices, discoveries, applications, tenants, global, result });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Admin: export JSON snapshot for backup
app.get("/admin/snapshot", requireAuth, async (req, res) => {
  try {
    let whereTenant = {};
    if (req.user.tenantId) {
      whereTenant = { tenantId: req.user.tenantId };
    } else {
      const def = await prisma.tenant.findUnique({ where: { name: "default" } });
      whereTenant = def ? { tenantId: def.id } : { tenantId: -1 };
    }
    const [tenants, devices, interfaces, peers, applications] = await Promise.all([
      req.user.tenantId
        ? prisma.tenant.findMany({ where: { id: req.user.tenantId } })
        : prisma.tenant.findMany({ where: { name: "default" } }),
      prisma.device.findMany({ where: whereTenant }),
      prisma.discoveredInterface.findMany({ where: whereTenant }),
      prisma.discoveredBgpPeer.findMany({ where: whereTenant }),
      prisma.application.findMany({ where: whereTenant }),
    ]);

    const snapshot = {
      meta: {
        exportedAt: new Date().toISOString(),
        scope: req.user.tenantId ? { tenantId: req.user.tenantId } : { tenantId: null, role: req.user.role },
      },
      tenants,
      devices,
      discoveredInterfaces: interfaces,
      discoveredBgpPeers: peers,
      applications,
    };

    await logAudit(req, 'snapshot', { count: { tenants: tenants.length, devices: devices.length, interfaces: interfaces.length, peers: peers.length, applications: applications.length } });
    res.setHeader('Content-Type', 'application/json');
    res.json(snapshot);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Admin: import JSON snapshot (merge/overwrite options)
app.post("/admin/import-snapshot", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, options } = req.body || {};
    if (!data || typeof data !== 'object') return res.status(400).json({ error: "Snapshot 'data' inválido" });
    const {
      importTenants = true,
      importDevices = true,
      importApplications = true,
      importDiscoveries = true,
      overwriteTenants = false,
      overwriteDevices = false,
      overwriteApplications = false,
      overwriteDiscoveries = false,
      dryRun = false,
    } = options || {};

    const commit = !dryRun;
    // Overwrite (dangerous): remove all for selected entities
    if (commit && overwriteDiscoveries) {
      await prisma.discoveredInterface.deleteMany({});
      await prisma.discoveredBgpPeer.deleteMany({});
    }
    if (commit && overwriteDevices) {
      await prisma.discoveredInterface.deleteMany({});
      await prisma.discoveredBgpPeer.deleteMany({});
      await prisma.device.deleteMany({});
    }
    if (commit && overwriteApplications) {
      await prisma.application.deleteMany({});
    }
    if (commit && overwriteTenants) {
      await prisma.tenant.deleteMany({});
    }

    // Build tenant mapping snapshotTenantId -> dbTenantId using tenant name
    const tenantMap = new Map();
    const tenants = Array.isArray(data.tenants) ? data.tenants : [];
    if (importTenants) {
      for (const t of tenants) {
        if (commit) {
          const created = await prisma.tenant.upsert({
            where: { name: t.name },
            update: { description: t.description || null, tenantGroup: t.tenantGroup || null },
            create: { name: t.name, description: t.description || null, tenantGroup: t.tenantGroup || null },
          });
          tenantMap.set(t.id, created.id);
        } else {
          // simulate id mapping with fake incremental
          if (!tenantMap.has(t.id)) tenantMap.set(t.id, t.id);
        }
      }
    } else {
      for (const t of tenants) {
        const found = await prisma.tenant.findUnique({ where: { name: t.name } });
        if (found) tenantMap.set(t.id, found.id);
      }
    }

    const results = { tenants: tenantMap.size, devices: 0, applications: 0, interfaces: 0, peers: 0 };

    // Devices
    const devices = Array.isArray(data.devices) ? data.devices : [];
    if (importDevices) {
      for (const d of devices) {
        const newTenantId = tenantMap.get(d.tenantId) || d.tenantId || null;
        if (!newTenantId) continue;
        const existing = await prisma.device.findFirst({ where: { tenantId: newTenantId, name: d.name } });
        if (commit) {
          if (existing) {
            await prisma.device.update({
              where: { id: existing.id },
              data: {
                hostname: d.hostname || null,
                ipAddress: d.ipAddress || existing.ipAddress,
                deviceType: d.deviceType || existing.deviceType,
                manufacturer: d.manufacturer || existing.manufacturer,
                model: d.model || existing.model,
                osVersion: d.osVersion || null,
                status: d.status || existing.status,
                location: d.location || null,
                description: d.description || null,
                snmpVersion: d.snmpVersion || null,
                snmpCommunity: d.snmpCommunity || null,
                snmpPort: d.snmpPort || null,
              },
            });
          } else {
            await prisma.device.create({
              data: {
                tenantId: newTenantId,
                name: d.name,
                hostname: d.hostname || null,
                ipAddress: d.ipAddress || "0.0.0.0",
                deviceType: d.deviceType || "router",
                manufacturer: d.manufacturer || "unknown",
                model: d.model || "unknown",
                osVersion: d.osVersion || null,
                status: d.status || "inactive",
                location: d.location || null,
                description: d.description || null,
                snmpVersion: d.snmpVersion || null,
                snmpCommunity: d.snmpCommunity || null,
                snmpPort: d.snmpPort || null,
              },
            });
          }
        }
        results.devices++;
      }
    }

    // Applications
    const applications = Array.isArray(data.applications) ? data.applications : [];
    if (importApplications) {
      for (const a of applications) {
        const newTenantId = tenantMap.get(a.tenantId) || a.tenantId || null;
        if (!newTenantId) continue;
        const existing = await prisma.application.findFirst({ where: { tenantId: newTenantId, name: a.name } });
        if (commit) {
          if (existing) {
            await prisma.application.update({ where: { id: existing.id }, data: { url: a.url, apiKey: a.apiKey, status: a.status || existing.status, description: a.description || null } });
          } else {
            await prisma.application.create({ data: { tenantId: newTenantId, name: a.name, url: a.url, apiKey: a.apiKey, status: a.status || "disconnected", description: a.description || null } });
          }
        }
        results.applications++;
      }
    }

    // Build device name -> id map per tenant
    const allDevices = await prisma.device.findMany({ select: { id: true, name: true, tenantId: true } });
    const deviceKey = (name, tenantId) => `${tenantId}::${name}`;
    const deviceMap = new Map(allDevices.map((d) => [deviceKey(d.name, d.tenantId), d.id]));

    // Discovered Interfaces
    const discIfs = Array.isArray(data.discoveredInterfaces) ? data.discoveredInterfaces : [];
    if (importDiscoveries && discIfs.length > 0) {
      for (const r of discIfs) {
        const newTenantId = tenantMap.get(r.tenantId) || r.tenantId || null;
        if (!newTenantId) continue;
        const devId = deviceMap.get(deviceKey(r.deviceName, newTenantId));
        if (!devId) continue;
        if (commit) {
          await prisma.discoveredInterface.create({ data: { tenantId: newTenantId, deviceId: devId, deviceName: r.deviceName, ifIndex: String(r.ifIndex), ifName: String(r.ifName || ''), ifDesc: r.ifDesc || null, ifType: Number(r.ifType || 0) } });
        }
        results.interfaces++;
      }
    }

    // Discovered BGP Peers
    const discPeers = Array.isArray(data.discoveredBgpPeers) ? data.discoveredBgpPeers : [];
    if (importDiscoveries && discPeers.length > 0) {
      for (const p of discPeers) {
        const newTenantId = tenantMap.get(p.tenantId) || p.tenantId || null;
        if (!newTenantId) continue;
        const devId = deviceMap.get(deviceKey(p.deviceName, newTenantId));
        if (!devId) continue;
        if (commit) {
          await prisma.discoveredBgpPeer.create({ data: { tenantId: newTenantId, deviceId: devId, deviceName: p.deviceName, ipPeer: String(p.ipPeer || ''), asn: Number(p.asn || 0), name: p.name || null, vrfName: p.vrfName || null } });
        }
        results.peers++;
      }
    }

    await logAudit(req, commit ? 'import' : 'import-dryrun', { options: { importTenants, importDevices, importApplications, importDiscoveries, overwriteTenants, overwriteDevices, overwriteApplications, overwriteDiscoveries, dryRun }, results });
    res.json({ ok: commit, dryRun: !commit, ...results });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Admin: list audit logs with optional filters (tenant-scoped for non-admins)
app.get("/admin/audit", requireAuth, async (req, res) => {
  try {
    const { action, from, to, limit = 50 } = req.query || {};
    const where = {};
    if (req.user.tenantId) where.tenantId = req.user.tenantId;
    if (action) where.action = String(action);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) where.createdAt.lte = new Date(String(to));
    }
    const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: Number(limit) || 50 });
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Tenants listing: admin -> all, user -> own
app.get("/tenants", requireAuth, async (req, res) => {
  try {
    const GROUP_FILTER = process.env.NETBOX_TENANT_GROUP_FILTER || "K3G Solutions";
    let where = {};
    if (req.user.tenantId) {
      where = { id: req.user.tenantId };
    } else {
      // Admin/global: restringe por Tenant Group conforme solicitado
      where = { tenantGroup: GROUP_FILTER };
    }
    const list = await prisma.tenant.findMany({ where, orderBy: { name: "asc" } });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Users management (admin only)
app.get("/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
    res.json(users.map(u => ({ id: u.id, email: u.email, username: u.username, role: u.role, isActive: u.isActive, tenantId: u.tenantId, mustResetPassword: u.mustResetPassword })));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, username, password, role = "user", isActive = true, tenantId, tenantName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    let tId = tenantId || null;
    if (!tId && tenantName) {
      const t = await prisma.tenant.upsert({ where: { name: tenantName }, update: {}, create: { name: tenantName } });
      tId = t.id;
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, username: username || email, passwordHash: hash, role, isActive, tenantId: tId } });
    await logAudit(req, 'user-create', { id: user.id, email, role, tenantId: tId });
    res.status(201).json({ id: user.id, email: user.email, username: user.username, role: user.role, isActive: user.isActive, tenantId: user.tenantId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role, isActive, password, tenantId, mustResetPassword } = req.body || {};
    const data = {};
    if (typeof role === 'string') data.role = role;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (tenantId !== undefined) data.tenantId = tenantId;
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    if (typeof mustResetPassword === 'boolean') data.mustResetPassword = mustResetPassword;
    const updated = await prisma.user.update({ where: { id }, data });
    await logAudit(req, 'user-update', { id, role: updated.role, isActive: updated.isActive, tenantId: updated.tenantId, changed: Object.keys(data) });
    res.json({ id: updated.id, email: updated.email, username: updated.username, role: updated.role, isActive: updated.isActive, tenantId: updated.tenantId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const u = await prisma.user.delete({ where: { id } });
    await logAudit(req, 'user-delete', { id, email: u.email });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Logs endpoint - returns application logs
app.get("/admin/logs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { execSync } = await import('child_process');
    const lines = Number(req.query.lines) || 500;
    const filter = String(req.query.filter || '').trim();

    // Get logs from docker container
    const containerName = 'netbox-ops-center-app';
    let logs = '';

    try {
      logs = execSync(`docker logs --tail ${lines} ${containerName} 2>&1`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });
    } catch (e) {
      // If docker command fails, return empty logs
      logs = '[ERROR] Could not retrieve logs from Docker container\n';
    }

    // Split into lines and apply filter if provided
    let logLines = logs.split('\n');

    if (filter) {
      const filterLower = filter.toLowerCase();
      logLines = logLines.filter(line =>
        line.toLowerCase().includes(filterLower)
      );
    }

    res.json({
      logs: logLines,
      totalLines: logLines.length,
      filter: filter || null,
      container: containerName
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Servir script de instalação do Oxidized Proxy
app.get("/oxidized-proxy/install.sh", async (_req, res) => {
  try {
    const scriptPath = path.join(__dirname, "../../public/oxidized-proxy/install.sh");
    const scriptContent = await fs.readFile(scriptPath, "utf8");
    res.type("text/plain").send(scriptContent);
  } catch (e) {
    res.status(404).json({ error: "Install script not found" });
  }
});

let shuttingDown = false;
// Health check endpoint for microservices monitoring
app.get('/health/services', async (_req, res) => {
  const services = {
    api: { status: 'ok', port: PORT },
    snmp: { status: 'unknown', port: 3001 },
    redis: { status: 'unknown', port: 6379 },
    database: { status: 'unknown' },
    queues: { status: 'unknown', workers: 0 },
  };

  // Check SNMP server
  try {
    const snmpUrl = process.env.SNMP_SERVER_URL || 'http://localhost:3001';
    const snmpRes = await fetch(`${snmpUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    services.snmp.status = snmpRes && snmpRes.ok ? 'ok' : 'error';
  } catch {
    services.snmp.status = 'error';
  }

  // Check Redis
  try {
    const { connection } = await import('./queues/index.js');
    await connection.ping();
    services.redis.status = 'ok';
  } catch {
    services.redis.status = 'error';
  }

  // Check Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.database.status = 'ok';
  } catch {
    services.database.status = 'error';
  }

  // Check Queues (workers running)
  try {
    const queueMap = getAllQueues();
    const queueStats = {};

    for (const [queueName, queue] of queueMap) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        queueStats[queueName] = {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          failed: counts.failed || 0,
          delayed: counts.delayed || 0,
        };
      } catch (err) {
        queueStats[queueName] = { error: err.message };
      }
    }

    services.queues.status = 'ok';
    services.queues.total = queueMap.size;
    services.queues.stats = queueStats;
  } catch (err) {
    services.queues.status = 'error';
    services.queues.error = err.message;
  }

  // Overall health
  const allOk = Object.values(services).every(s => s.status === 'ok');
  res.status(allOk ? 200 : 503).json({
    overall: allOk ? 'healthy' : 'unhealthy',
    services,
    timestamp: new Date().toISOString(),
  });
});

async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[SHUTDOWN] Finalizando filas e workers...');
  await closeQueues().catch(() => { });
  await prisma.$disconnect().catch(() => { });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    bootstrapBackground();
  });
}

export default app;
