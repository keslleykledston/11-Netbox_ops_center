import fetch from "node-fetch";

function authHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function fetchList(url, token) {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`NetBox HTTP ${res.status}`);
  const json = await res.json();
  return json?.results || [];
}

import { encryptSecret } from "./cred.js";
import { getOxidizedModel } from "./modules/monitor/vendor-map.js";
import { getDeviceSecrets } from "./netboxSecrets.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PENDING_REFRESH_INTERVAL_MS = (() => {
  const rawMs = Number(process.env.NETBOX_PENDING_REFRESH_INTERVAL_MS);
  if (Number.isFinite(rawMs) && rawMs > 0) return rawMs;
  const rawSeconds = Number(process.env.NETBOX_PENDING_REFRESH_INTERVAL_SECONDS);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) return rawSeconds * 1000;
  return 10 * 60 * 1000;
})();

function computeNextCheckAt() {
  return new Date(Date.now() + PENDING_REFRESH_INTERVAL_MS);
}

function parseNetboxTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function collectMissingFields({ ipAddress, credUsername, credPassword }) {
  const missing = [];
  const ip = String(ipAddress || '').trim();
  if (!ip || ip === '0.0.0.0') missing.push('ipAddress');
  if (!credUsername) missing.push('username');
  if (!credPassword) missing.push('password');
  return missing;
}

async function upsertPendingDevice(prisma, {
  netboxId,
  tenantNetboxId,
  tenantName,
  deviceName,
  ipAddress,
  missingFields = [],
  nextCheckAt,
  lastError = null,
} = {}) {
  if (!netboxId) return { status: 'skipped' };
  const now = new Date();
  const normalizedMissing = Array.isArray(missingFields) ? missingFields.filter(Boolean) : [];

  if (normalizedMissing.length === 0) {
    const existing = await prisma.netboxPendingDevice.findUnique({ where: { netboxId } });
    if (!existing) return { status: 'clear' };
    await prisma.netboxPendingDevice.update({
      where: { netboxId },
      data: {
        status: 'resolved',
        missingFields: null,
        lastError: null,
        nextCheckAt: null,
        tenantNetboxId: tenantNetboxId ?? existing.tenantNetboxId,
        tenantName: tenantName ?? existing.tenantName,
        deviceName: deviceName ?? existing.deviceName,
        ipAddress: ipAddress ?? existing.ipAddress,
        lastSeenAt: now,
      },
    });
    return { status: 'resolved' };
  }

  const payload = {
    tenantNetboxId: tenantNetboxId ?? null,
    tenantName: tenantName ?? null,
    deviceName: deviceName ?? null,
    ipAddress: ipAddress ?? null,
    missingFields: JSON.stringify(normalizedMissing),
    status: 'pending',
    nextCheckAt: nextCheckAt || computeNextCheckAt(),
    lastSeenAt: now,
    ...(lastError ? { lastError: String(lastError) } : {}),
  };

  const existing = await prisma.netboxPendingDevice.findUnique({ where: { netboxId } });
  if (existing) {
    await prisma.netboxPendingDevice.update({
      where: { netboxId },
      data: payload,
    });
    return { status: 'pending', created: false };
  }
  await prisma.netboxPendingDevice.create({
    data: {
      netboxId,
      ...payload,
    },
  });
  return { status: 'pending', created: true };
}

async function fetchAllPages(url, token) {
  const results = [];
  let nextUrl = url;
  const baseUrl = new URL(url);
  const baseScheme = baseUrl.protocol;

  const normalizeNext = (value) => {
    if (!value) return null;
    if (value.startsWith('/')) return `${baseUrl.origin}${value}`;
    if (baseScheme === 'https:' && value.startsWith('http://')) {
      return value.replace('http://', 'https://');
    }
    return value;
  };

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`NetBox HTTP ${res.status}`);
    const json = await res.json();
    if (Array.isArray(json)) {
      results.push(...json);
      break;
    }
    if (Array.isArray(json?.results)) results.push(...json.results);
    nextUrl = normalizeNext(json?.next || null);
  }

  return results;
}

// Removed legacy fetchDeviceSecrets and getSessionKey as they are now handled by netboxClient/netboxSecrets
// Helper to fetch config context if needed

// Helper to fetch config context if needed
async function fetchConfigContext(url, token, deviceId) {
  try {
    const res = await fetch(`${url}/api/dcim/devices/${deviceId}/config-context/`, { headers: authHeaders(token) });
    if (res.ok) return await res.json();
  } catch { }
  return null;
}

// Helper to fetch ALL services (SSH/Telnet ports) from NetBox with pagination
async function fetchAllServices(url, token) {
  const servicesMap = new Map(); // deviceId -> { sshPort, telnetPort }
  let nextUrl = `${url}/api/ipam/services/?limit=1000`;

  try {
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: authHeaders(token) });
      if (!res.ok) break;

      const data = await res.json();
      nextUrl = data.next;

      // Fix mixed content issue: if original URL is https, ensure nextUrl is also https
      if (nextUrl && url.startsWith('https://') && nextUrl.startsWith('http://')) {
        nextUrl = nextUrl.replace('http://', 'https://');
      }

      if (data.results) {
        for (const service of data.results) {
          if (!service.device?.id) continue;

          const deviceId = service.device.id;

          const ports = service.ports || [];
          const protocol = service.protocol?.value?.toLowerCase() || '';
          const serviceName = (service.name || '').toLowerCase();

          let sshPort = null;
          let telnetPort = null;

          for (const port of ports) {
            if (port === 22 || (serviceName.includes('ssh') && protocol === 'tcp')) {
              sshPort = port;
            }
            if (port === 23 || (serviceName.includes('telnet') && protocol === 'tcp')) {
              telnetPort = port;
            }
          }

          if (sshPort || telnetPort) {
            // If we already have an entry, merge it (e.g. multiple services per device)
            const existing = servicesMap.get(deviceId) || { sshPort: null, telnetPort: null };
            if (sshPort) existing.sshPort = sshPort;
            if (telnetPort) existing.telnetPort = telnetPort;
            servicesMap.set(deviceId, existing);
          }
        }
      }
    }
    console.log(`[SERVICES] Fetched services for ${servicesMap.size} devices.`);
    return servicesMap;
  } catch (e) {
    console.warn(`[SERVICES] Error fetching all services:`, e.message);
  }
  return new Map();
}

const extractTenantSnmp = (cf) => {
  if (!cf) return { community: null, port: null };
  const community = cf["SNMP Community"] || cf["snmpCommunity"] || cf["snmp_community"] || cf["snmpcommunity"] || null;
  const portRaw = cf["SNMP Port"] || cf["snmpPort"] || cf["snmp_port"] || null;
  const parsedPort = portRaw !== null && portRaw !== undefined ? Number(portRaw) : null;
  const port = Number.isNaN(parsedPort) ? null : parsedPort;
  return { community, port };
};

async function fetchTenantById(url, token, tenantId) {
  if (!tenantId) return null;
  try {
    const res = await fetch(`${url}/api/tenancy/tenants/${tenantId}/`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchSiteById(url, token, siteId) {
  if (!siteId) return null;
  try {
    const res = await fetch(`${url}/api/dcim/sites/${siteId}/`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchServicesForDevice(url, token, deviceId) {
  const services = [];
  if (!deviceId) return services;
  let nextUrl = `${url}/api/ipam/services/?limit=200&device_id=${deviceId}`;
  while (nextUrl) {
    try {
      const res = await fetch(nextUrl, { headers: authHeaders(token) });
      if (!res.ok) break;
      const data = await res.json();
      if (Array.isArray(data?.results)) services.push(...data.results);
      nextUrl = data?.next || null;
      if (nextUrl && url.startsWith('https://') && nextUrl.startsWith('http://')) {
        nextUrl = nextUrl.replace('http://', 'https://');
      }
    } catch {
      break;
    }
  }
  return services;
}

async function ensureTenantSnapshot(prisma, tenantObj) {
  if (!tenantObj?.id) return null;
  if (!tenantObj?.name) {
    const existing = await prisma.netboxTenantSnapshot.findUnique({ where: { netboxId: tenantObj.id } });
    return existing ? tenantObj.id : null;
  }
  const hasFullData = Boolean(
    tenantObj.custom_fields ||
    tenantObj.description ||
    tenantObj.slug ||
    tenantObj.group ||
    tenantObj.tenant_group
  );
  if (!hasFullData) {
    const existing = await prisma.netboxTenantSnapshot.findUnique({ where: { netboxId: tenantObj.id } });
    if (existing) return tenantObj.id;
    await prisma.netboxTenantSnapshot.create({
      data: {
        netboxId: tenantObj.id,
        name: tenantObj.name,
        slug: tenantObj.slug || null,
        groupName: tenantObj?.group?.name || tenantObj?.tenant_group?.name || null,
        description: tenantObj.description || null,
        rawData: JSON.stringify(tenantObj),
        lastSeenAt: new Date(),
      },
    });
    return tenantObj.id;
  }
  const cf = tenantObj.custom_fields || {};
  const erpId = cf?.ERP_ID || cf?.erp_id || cf?.movidesk_id || null;
  const cnpj = cf?.CNPJ || cf?.cnpj || null;
  await prisma.netboxTenantSnapshot.upsert({
    where: { netboxId: tenantObj.id },
    update: {
      name: tenantObj.name,
      slug: tenantObj.slug || null,
      groupName: tenantObj?.group?.name || tenantObj?.tenant_group?.name || null,
      erpId: erpId ? String(erpId) : null,
      cnpj: cnpj ? String(cnpj) : null,
      description: tenantObj.description || null,
      rawData: JSON.stringify(tenantObj),
      lastSeenAt: new Date(),
    },
    create: {
      netboxId: tenantObj.id,
      name: tenantObj.name,
      slug: tenantObj.slug || null,
      groupName: tenantObj?.group?.name || tenantObj?.tenant_group?.name || null,
      erpId: erpId ? String(erpId) : null,
      cnpj: cnpj ? String(cnpj) : null,
      description: tenantObj.description || null,
      rawData: JSON.stringify(tenantObj),
      lastSeenAt: new Date(),
    },
  });
  return tenantObj.id;
}

async function ensureSiteSnapshot(prisma, siteObj, { url, token, fallbackTenantNetboxId = null } = {}) {
  if (!siteObj?.id) return null;
  let siteData = siteObj;
  if (!siteObj?.name && url && token) {
    const fetched = await fetchSiteById(url, token, siteObj.id);
    if (fetched) siteData = fetched;
  }
  if (!siteData?.name) {
    const existing = await prisma.netboxSiteSnapshot.findUnique({ where: { netboxId: siteObj.id } });
    return existing ? siteObj.id : null;
  }
  const hasFullData = Boolean(
    siteData.slug ||
    siteData.status ||
    siteData.tenant ||
    siteData.description
  );
  if (!hasFullData) {
    const existing = await prisma.netboxSiteSnapshot.findUnique({ where: { netboxId: siteData.id } });
    if (existing) return siteData.id;
    await prisma.netboxSiteSnapshot.create({
      data: {
        netboxId: siteData.id,
        name: siteData.name,
        slug: siteData.slug || null,
        status: siteData.status?.value || siteData.status || null,
        tenantNetboxId: siteData?.tenant?.id || fallbackTenantNetboxId || null,
        rawData: JSON.stringify(siteData),
        lastSeenAt: new Date(),
      },
    });
    return siteData.id;
  }
  const tenantId = siteData?.tenant?.id || fallbackTenantNetboxId || null;
  await prisma.netboxSiteSnapshot.upsert({
    where: { netboxId: siteData.id },
    update: {
      name: siteData.name,
      slug: siteData.slug || null,
      status: siteData.status?.value || siteData.status || null,
      tenantNetboxId: tenantId,
      rawData: JSON.stringify(siteData),
      lastSeenAt: new Date(),
    },
    create: {
      netboxId: siteData.id,
      name: siteData.name,
      slug: siteData.slug || null,
      status: siteData.status?.value || siteData.status || null,
      tenantNetboxId: tenantId,
      rawData: JSON.stringify(siteData),
      lastSeenAt: new Date(),
    },
  });
  return siteData.id;
}

export async function syncFromNetbox(prisma, { url, token, resources = ["tenants", "devices"], tenantScopeId, deviceFilters, defaultCredentials = {}, fullSync = false }) {
  if (!url || !token) throw new Error("NETBOX_URL/NETBOX_TOKEN ausentes");

  const result = { tenants: 0, devices: 0, sites: 0, pending: { created: 0, resolved: 0 } };
  const GROUP_FILTER = process.env.NETBOX_TENANT_GROUP_FILTER || "K3G Solutions";
  let allowedTenants = new Set();
  const tenantSnmpById = new Map();
  const tenantSnmpByName = new Map();
  const normalize = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const normList = (arr) => Array.isArray(arr) ? arr.map(normalize).filter(Boolean) : [];
  const syncKey = 'devices';
  const syncTenantId = tenantScopeId || null;
  let lastCursor = null;
  let maxUpdatedAt = null;
  let fullSyncCompleted = false;

  if (resources.includes("devices")) {
    try {
      const existingState = syncTenantId === null
        ? await prisma.netboxSyncState.findFirst({ where: { key: syncKey, tenantId: null } })
        : await prisma.netboxSyncState.findUnique({
          where: { key_tenantId: { key: syncKey, tenantId: syncTenantId } },
        });
      if (existingState?.lastCursor && !fullSync) {
        lastCursor = existingState.lastCursor;
      }
      if (existingState?.metadata) {
        try {
          const parsed = JSON.parse(existingState.metadata);
          fullSyncCompleted = Boolean(parsed?.fullSyncCompleted || parsed?.fullSync);
        } catch { }
      }
      if (fullSync) fullSyncCompleted = true;
      if (existingState) {
        await prisma.netboxSyncState.update({
          where: { id: existingState.id },
          data: { lastRunAt: new Date() },
        });
      } else {
        await prisma.netboxSyncState.create({
          data: {
            key: syncKey,
            tenantId: syncTenantId,
            lastCursor,
            lastRunAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.warn('[NetBox][WARN] Failed to load sync state:', err?.message || err);
    }
  }

  if (resources.includes("tenants")) {
    const tenants = await fetchAllPages(`${url}/api/tenancy/tenants/?limit=1000`, token);
    const filtered = tenants.filter((t) => {
      const gname = t?.group?.name || t?.tenant_group?.name || null;
      return !GROUP_FILTER || gname === GROUP_FILTER;
    });
    for (const t of filtered) {
      const cf = t.custom_fields || {};
      const erpId = cf?.ERP_ID || cf?.erp_id || cf?.movidesk_id || null;
      const cnpj = cf?.CNPJ || cf?.cnpj || null;
      const tenantSnmp = extractTenantSnmp(cf);

      await prisma.tenant.upsert({
        where: { name: t.name },
        update: { description: t.description || null, tenantGroup: t?.group?.name || null },
        create: { name: t.name, description: t.description || null, tenantGroup: t?.group?.name || null },
      });
      await prisma.netboxTenantSnapshot.upsert({
        where: { netboxId: t.id },
        update: {
          name: t.name,
          slug: t.slug || null,
          groupName: t?.group?.name || t?.tenant_group?.name || null,
          erpId: erpId ? String(erpId) : null,
          cnpj: cnpj ? String(cnpj) : null,
          description: t.description || null,
          rawData: JSON.stringify(t),
          lastSeenAt: new Date(),
        },
        create: {
          netboxId: t.id,
          name: t.name,
          slug: t.slug || null,
          groupName: t?.group?.name || t?.tenant_group?.name || null,
          erpId: erpId ? String(erpId) : null,
          cnpj: cnpj ? String(cnpj) : null,
          description: t.description || null,
          rawData: JSON.stringify(t),
          lastSeenAt: new Date(),
        },
      });
      allowedTenants.add(t.name);
      if (tenantSnmp.community || tenantSnmp.port) {
        tenantSnmpById.set(t.id, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
        tenantSnmpByName.set(t.name, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
      }
      result.tenants++;
    }
  }
  // Ensure allowedTenants filter is populated when syncing devices only
  if (!resources.includes("tenants") && resources.includes("devices") && GROUP_FILTER) {
    const tenants = await fetchAllPages(`${url}/api/tenancy/tenants/?limit=1000`, token).catch(() => []);
    for (const t of tenants) {
      const gname = t?.group?.name || t?.tenant_group?.name || null;
      if (gname === GROUP_FILTER) allowedTenants.add(t.name);
      const cf = t.custom_fields || {};
      const tenantSnmp = extractTenantSnmp(cf);
      if (tenantSnmp.community || tenantSnmp.port) {
        tenantSnmpById.set(t.id, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
        tenantSnmpByName.set(t.name, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
      }
    }
  }
  if (!resources.includes("tenants") && resources.includes("devices") && tenantSnmpById.size === 0) {
    const tenants = await fetchAllPages(`${url}/api/tenancy/tenants/?limit=1000`, token).catch(() => []);
    for (const t of tenants) {
      const cf = t.custom_fields || {};
      const tenantSnmp = extractTenantSnmp(cf);
      if (tenantSnmp.community || tenantSnmp.port) {
        tenantSnmpById.set(t.id, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
        tenantSnmpByName.set(t.name, {
          community: tenantSnmp.community ? String(tenantSnmp.community) : null,
          port: tenantSnmp.port !== undefined && tenantSnmp.port !== null ? Number(tenantSnmp.port) : null,
        });
      }
    }
  }

  if (resources.includes("sites")) {
    const sites = await fetchAllPages(`${url}/api/dcim/sites/?limit=1000`, token);
    for (const s of sites) {
      const siteTenantName = s?.tenant?.name || null;
      if (allowedTenants.size > 0 && siteTenantName && !allowedTenants.has(siteTenantName)) {
        continue;
      }
      const siteTenantId = await ensureTenantSnapshot(prisma, s.tenant);
      await prisma.netboxSiteSnapshot.upsert({
        where: { netboxId: s.id },
        update: {
          name: s.name,
          slug: s.slug || null,
          status: s.status?.value || s.status || null,
          tenantNetboxId: siteTenantId || null,
          rawData: JSON.stringify(s),
          lastSeenAt: new Date(),
        },
        create: {
          netboxId: s.id,
          name: s.name,
          slug: s.slug || null,
          status: s.status?.value || s.status || null,
          tenantNetboxId: siteTenantId || null,
          rawData: JSON.stringify(s),
          lastSeenAt: new Date(),
        },
      });
      result.sites++;
    }
  }

  if (resources.includes("devices")) {
    // Fetch all services upfront
    const incrementalSync = Boolean(lastCursor);
    const servicesMap = incrementalSync ? new Map() : await fetchAllServices(url, token);

    const filterRoles = normList(deviceFilters?.roles);
    const filterPlatforms = normList(deviceFilters?.platforms);
    const filterDeviceTypes = normList(deviceFilters?.deviceTypes);
    const filterSites = normList(deviceFilters?.sites);

    const deviceUrl = new URL(`${url}/api/dcim/devices/`);
    deviceUrl.searchParams.set('limit', '1000');
    if (lastCursor) {
      deviceUrl.searchParams.set('last_updated__gte', lastCursor);
    }
    const devices = await fetchAllPages(deviceUrl.toString(), token);
    for (const d of devices) {
      const updatedAt = parseNetboxTimestamp(d?.last_updated || d?.lastUpdated || d?.updated);
      if (updatedAt && (!maxUpdatedAt || updatedAt > maxUpdatedAt)) {
        maxUpdatedAt = updatedAt;
      }
      const tenantName = d.tenant?.name || "NetBox";
      if (allowedTenants.size > 0 && !allowedTenants.has(tenantName)) {
        // Pula dispositivos cujo tenant não está no grupo filtrado
        continue;
      }
      // Filtros de função (device role) e plataforma
      const roleName = d.device_role?.name || d.role?.name || null;
      const roleSlug = d.device_role?.slug || d.role?.slug || null;
      const platformName = d.platform?.name || null;
      const platformSlug = d.platform?.slug || null;
      const typeName = d.device_type?.model || null;
      const typeSlug = d.device_type?.slug || null;
      const siteName = d.site?.name || null;
      const siteSlug = d.site?.slug || null;

      const roleCandidates = normList([roleName, roleSlug]);
      const platCandidates = normList([platformName, platformSlug]);
      const typeCandidates = normList([typeName, typeSlug]);
      const siteCandidates = normList([siteName, siteSlug]);

      const matchAny = (filters, candidates) => {
        if (!filters.length) return true;
        return candidates.some((c) => filters.some((f) => f === c || c.includes(f) || f.includes(c)));
      };

      if (!matchAny(filterRoles, roleCandidates)) continue;
      if (!matchAny(filterPlatforms, platCandidates)) continue;
      if (!matchAny(filterDeviceTypes, typeCandidates)) continue;
      if (!matchAny(filterSites, siteCandidates)) continue;
      // Filter out "Caixa Preta" devices (case insensitive, handles spaces/hyphens)
      if (/caixa[-_\s]*preta/i.test(d.name)) {
        continue;
      }

      console.log(`Processing Device: ${d.name} (ID: ${d.id})`);

      const tenant = await prisma.tenant.upsert({
        where: { name: tenantName },
        update: {},
        create: { name: tenantName },
      });
      console.log("Tenant Upserted");

      const tenantSnapshotId = await ensureTenantSnapshot(prisma, d.tenant);
      const siteSnapshotId = await ensureSiteSnapshot(prisma, d.site, { url, token, fallbackTenantNetboxId: d.tenant?.id || null });

      const ip = d.primary_ip?.address?.split("/")?.[0] || d.primary_ip4?.address?.split("/")?.[0] || "";
      const name = d.name || d.display || `Device-${d.id}`;
      let sshPort = null;
      let serviceName = null;
      let servicePort = null;

      // Custom Fields Mapping
      const cf = d.custom_fields || {};
      const sshPortHint = Number(cf["ssh_port"] || cf["SSH Port"] || null);
      if (sshPortHint && !Number.isNaN(sshPortHint)) {
        sshPort = sshPortHint;
        serviceName = "ssh";
        servicePort = sshPortHint;
      }
      // Check both lowercase and capitalized just in case, and specific keys found in JSON
      const backupEnabled = !!(cf["Backup"] || cf["backup"]);
      const isProduction = !!(cf["Production"] || cf["production"]);
      const jumpserverId = cf["ID do Dispositivo no JumpServer"] || cf["ID do Jumpserver"] || cf["id_do_dispositivo_no_jumpserver"] || cf["jumpserver_id"] || cf["JS_DEVICE_ID"] || null;
      const snmpCommunityCf = cf["SNMP Community"] || cf["snmpCommunity"] || cf["snmp_community"] || cf["snmpcommunity"] || null;
      const snmpPortCf = cf["SNMP Port"] || cf["snmpPort"] || cf["snmp_port"] || null;

      // Credentials Logic
      let credUsername = cf["username"] || cf["Username"] || null;
      let credPassword = cf["password"] || cf["Password"] || null;
      let netboxCredUsername = credUsername;
      let netboxCredPassword = credPassword;

      // If not in custom fields, try config_context from device object
      if (!credUsername && d.config_context) {
        credUsername = d.config_context.username || d.config_context.user || null;
        credPassword = d.config_context.password || d.config_context.pass || null;
      }
      if (!netboxCredUsername && credUsername) netboxCredUsername = credUsername;
      if (!netboxCredPassword && credPassword) netboxCredPassword = credPassword;
      let snmpCommunity = snmpCommunityCf || d.config_context?.snmp_community || d.config_context?.snmpCommunity || null;
      let snmpPort = snmpPortCf || d.config_context?.snmp_port || d.config_context?.snmpPort || null;

      // If still missing data and we have an ID, try fetching rendered config context
      const needsConfigContext = !credUsername || !credPassword || !snmpCommunity || snmpPort === null || snmpPort === undefined;
      if (needsConfigContext && d.id) {
        const cc = await fetchConfigContext(url, token, d.id);
        if (cc) {
          if (!credUsername) credUsername = cc.username || cc.user || null;
          if (!credPassword) credPassword = cc.password || cc.pass || null;
          if (!snmpCommunity) snmpCommunity = cc.snmp_community || cc.snmpCommunity || null;
          if (snmpPort === null || snmpPort === undefined) snmpPort = cc.snmp_port || cc.snmpPort || null;
          if (!netboxCredUsername && credUsername) netboxCredUsername = credUsername;
          if (!netboxCredPassword && credPassword) netboxCredPassword = credPassword;
        }
      }

      // Try fetching from Secrets Plugin (using new module)
      if ((!credUsername || !credPassword || !sshPort) && d.id) {
        const secrets = await getDeviceSecrets(d.id, { url, token });
        if (secrets) {
          if (!credUsername && secrets.username) credUsername = secrets.username;
          if (!credPassword && secrets.password) credPassword = secrets.password;
          // Also update SSH port if found in secrets and not yet set
          if (!sshPort && secrets.sshPort) sshPort = secrets.sshPort;
          if (!netboxCredUsername && secrets.username) netboxCredUsername = secrets.username;
          if (!netboxCredPassword && secrets.password) netboxCredPassword = secrets.password;
        }
      }

      // Tenant-level SNMP fallback (from NetBox tenant custom fields)
      if (!snmpCommunity || snmpPort === null || snmpPort === undefined) {
        const tenantSnmp = tenantSnmpById.get(d.tenant?.id) || tenantSnmpByName.get(tenantName) || null;
        if (!snmpCommunity && tenantSnmp?.community) snmpCommunity = tenantSnmp.community;
        if ((snmpPort === null || snmpPort === undefined) && tenantSnmp?.port) snmpPort = tenantSnmp.port;
      }

      // Fallback to Default Credentials (from Application config)
      if (!credUsername && defaultCredentials.username) credUsername = defaultCredentials.username;
      if (!credPassword && defaultCredentials.password) credPassword = defaultCredentials.password;

      // Fetch Services (SSH/Telnet ports) from Map or per-device when incremental
      if (d.id && servicesMap.size > 0) {
        const services = servicesMap.get(d.id);
        if (services?.sshPort) {
          sshPort = services.sshPort;
          serviceName = "ssh";
          servicePort = services.sshPort;
        } else if (services?.telnetPort) {
          serviceName = "telnet";
          servicePort = services.telnetPort;
        }
      }

      if (d.id && servicesMap.size === 0 && !sshPort) {
        const services = await fetchServicesForDevice(url, token, d.id);
        for (const service of services) {
          const ports = service.ports || [];
          const protocol = service.protocol?.value?.toLowerCase() || '';
          const serviceNameRaw = (service.name || '').toLowerCase();
          for (const port of ports) {
            if (port === 22 || (serviceNameRaw.includes('ssh') && protocol === 'tcp')) {
              sshPort = port;
              serviceName = "ssh";
              servicePort = port;
            }
            if (!sshPort && (port === 23 || (serviceNameRaw.includes('telnet') && protocol === 'tcp'))) {
              serviceName = "telnet";
              servicePort = port;
            }
          }
        }
      }

      // Fallback to Custom Fields if Services didn't have SSH port
      if (!sshPort) {
        sshPort = Number(cf["ssh_port"] || cf["SSH Port"] || 22);
      }
      if (!servicePort && sshPort) {
        serviceName = serviceName || "ssh";
        servicePort = sshPort;
      }
      if (snmpPort !== null && snmpPort !== undefined && snmpPort !== "") {
        const parsedSnmp = Number(snmpPort);
        snmpPort = Number.isNaN(parsedSnmp) ? null : parsedSnmp;
      } else {
        snmpPort = null;
      }

      // Determine Oxidized Model (Platform/Driver)
      const oxidizedModel = getOxidizedModel(d);
      const netboxPlatform = platformSlug || platformName || null;

      const updateData = {
        hostname: d.name || null,
        ipAddress: ip,
        manufacturer: d.device_type?.manufacturer?.name || "NetBox",
        platform: oxidizedModel, // Save the inferred driver (e.g. 'vrp', 'routeros')
        model: d.device_type?.model || "unknown", // Hardware model
        deviceType: d.device_role?.name || "router", // Mapping role to deviceType
        status: d.status?.value || "inactive",
        serial: d.serial || null,
        assetTag: d.asset_tag || null,
        site: d.site?.name || null,
        role: d.device_role?.name || null,
        backupEnabled,
        isProduction,
        jumpserverId,
        customData: JSON.stringify(cf),
        sshPort, // Use the port extracted from Services or Custom Fields
      };

      // Only update credentials if found in NetBox, otherwise keep existing
      if (credUsername) updateData.credUsername = credUsername;
      if (credPassword) {
        updateData.credPasswordEnc = encryptSecret(credPassword);
        updateData.credUpdatedAt = new Date();
      }
      if (snmpCommunity) updateData.snmpCommunity = String(snmpCommunity);
      if (snmpPort !== null) updateData.snmpPort = snmpPort;

      const existing = await prisma.device.findFirst({
        where: { name, tenantId: tenant.id },
      });
      console.log(existing ? "Device Found" : "Device Not Found");

      if (existing) {
        // Don't overwrite IP if it's 0.0.0.0 in NetBox but we have a valid one? 
        // Actually, NetBox should be source of truth.
        if (!ip && existing.ipAddress !== "0.0.0.0") delete updateData.ipAddress;

        console.log("Updating Device:", existing.id, JSON.stringify(updateData));
        await prisma.device.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        const createData = {
          tenantId: tenant.id,
          name,
          ...updateData,
          ipAddress: ip || "0.0.0.0",
        };
        console.log("Creating Device:", JSON.stringify(createData));
        await prisma.device.create({
          data: createData,
        });
      }

      await prisma.netboxDeviceSnapshot.upsert({
        where: { netboxId: d.id },
        update: {
          name,
          ipAddress: ip || null,
          tenantNetboxId: tenantSnapshotId,
          siteNetboxId: siteSnapshotId,
          platform: netboxPlatform,
          serviceName,
          servicePort,
          credUsername: netboxCredUsername || null,
          credPasswordEnc: netboxCredPassword ? encryptSecret(netboxCredPassword) : null,
          snmpCommunity: snmpCommunity ? String(snmpCommunity) : null,
          snmpPort,
          rawData: JSON.stringify(d),
          lastSeenAt: new Date(),
        },
        create: {
          netboxId: d.id,
          name,
          ipAddress: ip || null,
          tenantNetboxId: tenantSnapshotId,
          siteNetboxId: siteSnapshotId,
          platform: netboxPlatform,
          serviceName,
          servicePort,
          credUsername: netboxCredUsername || null,
          credPasswordEnc: netboxCredPassword ? encryptSecret(netboxCredPassword) : null,
          snmpCommunity: snmpCommunity ? String(snmpCommunity) : null,
          snmpPort,
          rawData: JSON.stringify(d),
          lastSeenAt: new Date(),
        },
      });

      const missingFields = collectMissingFields({
        ipAddress: ip,
        credUsername: credUsername || null,
        credPassword: credPassword || null,
      });
      try {
        const pendingRes = await upsertPendingDevice(prisma, {
          netboxId: d.id,
          tenantNetboxId: tenantSnapshotId,
          tenantName,
          deviceName: name,
          ipAddress: ip || null,
          missingFields,
        });
        if (pendingRes.status === 'pending' && pendingRes.created) result.pending.created += 1;
        if (pendingRes.status === 'resolved') result.pending.resolved += 1;
      } catch (e) {
        console.warn('[NetBox][WARN] Failed to update pending device state:', e?.message || e);
      }

      result.devices++;
    }
  }

  if (resources.includes("devices")) {
    try {
      const nextCursor = maxUpdatedAt ? maxUpdatedAt.toISOString() : lastCursor;
      const metadata = JSON.stringify({
        devices: result.devices,
        pendingCreated: result.pending.created,
        pendingResolved: result.pending.resolved,
        fullSync,
        fullSyncCompleted,
      });
      const existingState = syncTenantId === null
        ? await prisma.netboxSyncState.findFirst({ where: { key: syncKey, tenantId: null } })
        : await prisma.netboxSyncState.findUnique({
          where: { key_tenantId: { key: syncKey, tenantId: syncTenantId } },
        });
      if (existingState) {
        await prisma.netboxSyncState.update({
          where: { id: existingState.id },
          data: {
            lastCursor: nextCursor,
            lastSuccessAt: new Date(),
            lastError: null,
            metadata,
          },
        });
      } else {
        await prisma.netboxSyncState.create({
          data: {
            key: syncKey,
            tenantId: syncTenantId,
            lastCursor: nextCursor,
            lastSuccessAt: new Date(),
            metadata,
          },
        });
      }
    } catch (err) {
      console.warn('[NetBox][WARN] Failed to update sync state:', err?.message || err);
    }
  }

  return result;
}

export async function syncSingleDeviceFromNetbox(prisma, { url, token, deviceId, defaultCredentials = {}, tenantGroupFilter }) {
  if (!url || !token) throw new Error("NETBOX_URL/NETBOX_TOKEN ausentes");
  if (!deviceId) throw new Error("Device ID ausente");

  const res = await fetch(`${url}/api/dcim/devices/${deviceId}/`, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`NetBox HTTP ${res.status}`);
  }
  const d = await res.json();
  if (!d?.id) throw new Error("Dispositivo nao encontrado no NetBox");

  let tenantName = d.tenant?.name || "NetBox";
  let tenantId = d.tenant?.id || null;
  let tenant = null;

  const tenantData = await fetchTenantById(url, token, tenantId);
  if (tenantData) {
    tenantName = tenantData.name || tenantName;
    tenantId = tenantData.id || tenantId;
    if (tenantGroupFilter) {
      const gname = tenantData?.group?.name || tenantData?.tenant_group?.name || null;
      if (gname !== tenantGroupFilter) {
        throw new Error(`Tenant fora do grupo permitido (${tenantGroupFilter}).`);
      }
    }
  }

  tenant = await prisma.tenant.upsert({
    where: { name: tenantName },
    update: { description: tenantData?.description || null, tenantGroup: tenantData?.group?.name || null },
    create: { name: tenantName, description: tenantData?.description || null, tenantGroup: tenantData?.group?.name || null },
  });

  if (tenantData?.id) {
    const cf = tenantData.custom_fields || {};
    const erpId = cf?.ERP_ID || cf?.erp_id || cf?.movidesk_id || null;
    const cnpj = cf?.CNPJ || cf?.cnpj || null;
    await prisma.netboxTenantSnapshot.upsert({
      where: { netboxId: tenantData.id },
      update: {
        name: tenantData.name,
        slug: tenantData.slug || null,
        groupName: tenantData?.group?.name || tenantData?.tenant_group?.name || null,
        erpId: erpId ? String(erpId) : null,
        cnpj: cnpj ? String(cnpj) : null,
        description: tenantData.description || null,
        rawData: JSON.stringify(tenantData),
        lastSeenAt: new Date(),
      },
      create: {
        netboxId: tenantData.id,
        name: tenantData.name,
        slug: tenantData.slug || null,
        groupName: tenantData?.group?.name || tenantData?.tenant_group?.name || null,
        erpId: erpId ? String(erpId) : null,
        cnpj: cnpj ? String(cnpj) : null,
        description: tenantData.description || null,
        rawData: JSON.stringify(tenantData),
        lastSeenAt: new Date(),
      },
    });
  }
  const tenantSnapshotId = tenantData?.id
    ? tenantData.id
    : await ensureTenantSnapshot(prisma, { id: tenantId, name: tenantName, ...(tenantData || {}) });
  const siteSnapshotId = await ensureSiteSnapshot(prisma, d.site, { url, token, fallbackTenantNetboxId: tenantId || null });

  const ip = d.primary_ip?.address?.split("/")?.[0] || d.primary_ip4?.address?.split("/")?.[0] || "";
  const name = d.name || d.display || `Device-${d.id}`;
  let sshPort = null;
  let serviceName = null;
  let servicePort = null;

  const cf = d.custom_fields || {};
  const backupEnabled = !!(cf["Backup"] || cf["backup"]);
  const isProduction = !!(cf["Production"] || cf["production"]);
  const jumpserverId = cf["ID do Dispositivo no JumpServer"] || cf["ID do Jumpserver"] || cf["id_do_dispositivo_no_jumpserver"] || cf["jumpserver_id"] || cf["JS_DEVICE_ID"] || null;
  const snmpCommunityCf = cf["SNMP Community"] || cf["snmpCommunity"] || cf["snmp_community"] || cf["snmpcommunity"] || null;
  const snmpPortCf = cf["SNMP Port"] || cf["snmpPort"] || cf["snmp_port"] || null;

  let credUsername = cf["username"] || cf["Username"] || null;
  let credPassword = cf["password"] || cf["Password"] || null;
  let netboxCredUsername = credUsername;
  let netboxCredPassword = credPassword;

  if (!credUsername && d.config_context) {
    credUsername = d.config_context.username || d.config_context.user || null;
    credPassword = d.config_context.password || d.config_context.pass || null;
  }
  if (!netboxCredUsername && credUsername) netboxCredUsername = credUsername;
  if (!netboxCredPassword && credPassword) netboxCredPassword = credPassword;
  let snmpCommunity = snmpCommunityCf || d.config_context?.snmp_community || d.config_context?.snmpCommunity || null;
  let snmpPort = snmpPortCf || d.config_context?.snmp_port || d.config_context?.snmpPort || null;

  const needsConfigContext = !credUsername || !credPassword || !snmpCommunity || snmpPort === null || snmpPort === undefined;
  if (needsConfigContext && d.id) {
    const cc = await fetchConfigContext(url, token, d.id);
    if (cc) {
      if (!credUsername) credUsername = cc.username || cc.user || null;
      if (!credPassword) credPassword = cc.password || cc.pass || null;
      if (!snmpCommunity) snmpCommunity = cc.snmp_community || cc.snmpCommunity || null;
      if (snmpPort === null || snmpPort === undefined) snmpPort = cc.snmp_port || cc.snmpPort || null;
      if (!netboxCredUsername && credUsername) netboxCredUsername = credUsername;
      if (!netboxCredPassword && credPassword) netboxCredPassword = credPassword;
    }
  }

  if ((!credUsername || !credPassword || !sshPort) && d.id) {
    const secrets = await getDeviceSecrets(d.id, { url, token });
    if (secrets) {
      if (!credUsername && secrets.username) credUsername = secrets.username;
      if (!credPassword && secrets.password) credPassword = secrets.password;
      if (!sshPort && secrets.sshPort) sshPort = secrets.sshPort;
      if (!netboxCredUsername && secrets.username) netboxCredUsername = secrets.username;
      if (!netboxCredPassword && secrets.password) netboxCredPassword = secrets.password;
    }
  }

  if (!snmpCommunity || snmpPort === null || snmpPort === undefined) {
    const tenantSnmp = extractTenantSnmp(tenantData?.custom_fields || {});
    if (!snmpCommunity && tenantSnmp?.community) snmpCommunity = tenantSnmp.community;
    if ((snmpPort === null || snmpPort === undefined) && tenantSnmp?.port) snmpPort = tenantSnmp.port;
  }

  if (!credUsername && defaultCredentials.username) credUsername = defaultCredentials.username;
  if (!credPassword && defaultCredentials.password) credPassword = defaultCredentials.password;

  const services = await fetchServicesForDevice(url, token, d.id);
  for (const service of services) {
    const ports = service.ports || [];
    const protocol = service.protocol?.value?.toLowerCase() || '';
    const serviceNameRaw = (service.name || '').toLowerCase();
    for (const port of ports) {
      if (port === 22 || (serviceNameRaw.includes('ssh') && protocol === 'tcp')) {
        sshPort = port;
        serviceName = "ssh";
        servicePort = port;
      }
      if (port === 23 || (serviceNameRaw.includes('telnet') && protocol === 'tcp')) {
        if (!sshPort) {
          serviceName = "telnet";
          servicePort = port;
        }
      }
    }
  }

  if (!sshPort) {
    sshPort = Number(cf["ssh_port"] || cf["SSH Port"] || 22);
  }
  if (!servicePort && sshPort) {
    serviceName = serviceName || "ssh";
    servicePort = sshPort;
  }
  if (snmpPort !== null && snmpPort !== undefined && snmpPort !== "") {
    const parsedSnmp = Number(snmpPort);
    snmpPort = Number.isNaN(parsedSnmp) ? null : parsedSnmp;
  } else {
    snmpPort = null;
  }

  const oxidizedModel = getOxidizedModel(d);
  const platformName = d.platform?.name || null;
  const platformSlug = d.platform?.slug || null;
  const netboxPlatform = platformSlug || platformName || null;

  const updateData = {
    hostname: d.name || null,
    ipAddress: ip,
    manufacturer: d.device_type?.manufacturer?.name || "NetBox",
    platform: oxidizedModel,
    model: d.device_type?.model || "unknown",
    deviceType: d.device_role?.name || "router",
    status: d.status?.value || "inactive",
    serial: d.serial || null,
    assetTag: d.asset_tag || null,
    site: d.site?.name || null,
    role: d.device_role?.name || null,
    backupEnabled,
    isProduction,
    jumpserverId,
    customData: JSON.stringify(cf),
    sshPort,
  };

  if (credUsername) updateData.credUsername = credUsername;
  if (credPassword) {
    updateData.credPasswordEnc = encryptSecret(credPassword);
    updateData.credUpdatedAt = new Date();
  }
  if (snmpCommunity) updateData.snmpCommunity = String(snmpCommunity);
  if (snmpPort !== null) updateData.snmpPort = snmpPort;

  let device = await prisma.device.findFirst({
    where: { name, tenantId: tenant.id },
  });

  if (device) {
    if (!ip && device.ipAddress !== "0.0.0.0") delete updateData.ipAddress;
    device = await prisma.device.update({
      where: { id: device.id },
      data: updateData,
    });
  } else {
    device = await prisma.device.create({
      data: {
        tenantId: tenant.id,
        name,
        ...updateData,
        ipAddress: ip || "0.0.0.0",
      },
    });
  }

  await prisma.netboxDeviceSnapshot.upsert({
    where: { netboxId: d.id },
    update: {
      name,
      ipAddress: ip || null,
      tenantNetboxId: tenantSnapshotId,
      siteNetboxId: siteSnapshotId,
      platform: netboxPlatform,
      serviceName,
      servicePort,
      credUsername: netboxCredUsername || null,
      credPasswordEnc: netboxCredPassword ? encryptSecret(netboxCredPassword) : null,
      snmpCommunity: snmpCommunity ? String(snmpCommunity) : null,
      snmpPort,
      rawData: JSON.stringify(d),
      lastSeenAt: new Date(),
    },
    create: {
      netboxId: d.id,
      name,
      ipAddress: ip || null,
      tenantNetboxId: tenantSnapshotId,
      siteNetboxId: siteSnapshotId,
      platform: netboxPlatform,
      serviceName,
      servicePort,
      credUsername: netboxCredUsername || null,
      credPasswordEnc: netboxCredPassword ? encryptSecret(netboxCredPassword) : null,
      snmpCommunity: snmpCommunity ? String(snmpCommunity) : null,
      snmpPort,
      rawData: JSON.stringify(d),
      lastSeenAt: new Date(),
    },
  });

  const missingFields = collectMissingFields({
    ipAddress: ip,
    credUsername: credUsername || null,
    credPassword: credPassword || null,
  });
  try {
    await upsertPendingDevice(prisma, {
      netboxId: d.id,
      tenantNetboxId: tenantSnapshotId,
      tenantName,
      deviceName: name,
      ipAddress: ip || null,
      missingFields,
    });
  } catch (e) {
    console.warn('[NetBox][WARN] Failed to update pending device state:', e?.message || e);
  }

  return { device, netboxId: d.id, tenantId: tenant.id, tenantName };
}

export async function refreshPendingNetboxDevices(prisma, {
  url,
  token,
  limit = 50,
  defaultCredentials = {},
  tenantGroupFilter,
} = {}) {
  if (!url || !token) throw new Error("NETBOX_URL/NETBOX_TOKEN ausentes");

  const now = new Date();
  const pending = await prisma.netboxPendingDevice.findMany({
    where: {
      status: 'pending',
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
    },
    orderBy: { nextCheckAt: 'asc' },
    take: Number(limit) || 50,
  });

  const summary = { processed: 0, resolved: 0, stillPending: 0, errors: 0 };

  for (const item of pending) {
    summary.processed += 1;
    await prisma.netboxPendingDevice.update({
      where: { netboxId: item.netboxId },
      data: {
        attempts: { increment: 1 },
        lastCheckedAt: now,
        lastError: null,
      },
    });
    try {
      await syncSingleDeviceFromNetbox(prisma, {
        url,
        token,
        deviceId: item.netboxId,
        defaultCredentials,
        tenantGroupFilter,
      });
      const updated = await prisma.netboxPendingDevice.findUnique({ where: { netboxId: item.netboxId } });
      if (!updated || updated.status === 'resolved') summary.resolved += 1;
      else summary.stillPending += 1;
    } catch (err) {
      summary.errors += 1;
      await prisma.netboxPendingDevice.update({
        where: { netboxId: item.netboxId },
        data: {
          lastError: String(err?.message || err),
          nextCheckAt: computeNextCheckAt(),
        },
      });
    }
  }

  return summary;
}

export async function getNetboxCatalog({ url, token, resources = [] }) {
  if (!url || !token) throw new Error("NETBOX_URL/NETBOX_TOKEN ausentes");
  const out = {};
  for (const r of resources) {
    if (r === "device-roles") {
      const roles = await fetchList(`${url}/api/dcim/device-roles/?limit=1000`, token);
      out.roles = roles.map((it) => it?.name).filter(Boolean);
    }
    if (r === "platforms") {
      const plats = await fetchList(`${url}/api/dcim/platforms/?limit=1000`, token);
      out.platforms = plats.map((it) => it?.name).filter(Boolean);
    }
    if (r === "device-types") {
      const types = await fetchList(`${url}/api/dcim/device-types/?limit=1000`, token);
      // Use model as the display/filter value (matches d.device_type?.model)
      out.deviceTypes = types.map((it) => it?.model).filter(Boolean);
    }
    if (r === "sites") {
      const sites = await fetchList(`${url}/api/dcim/sites/?limit=1000`, token);
      out.sites = sites.map((it) => it?.name).filter(Boolean);
    }
  }
  return out;
}
