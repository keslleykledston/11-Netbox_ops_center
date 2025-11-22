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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache session key to avoid fetching it for every device
let cachedSessionKey = null;
let sessionKeyFailed = false;

async function getSessionKey(url, token) {
  if (cachedSessionKey) return cachedSessionKey;
  if (sessionKeyFailed) return null;

  try {
    const keyPath = path.join(__dirname, '../netbox_private_key.pem');
    if (!fs.existsSync(keyPath)) {
      sessionKeyFailed = true;
      return null;
    }

    const privateKey = fs.readFileSync(keyPath, 'utf8');
    // Ensure newline at end
    const pk = privateKey.endsWith('\n') ? privateKey : privateKey + '\n';

    const res = await fetch(`${url}/api/plugins/secrets/get-session-key/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ private_key: pk })
    });

    if (res.ok) {
      const data = await res.json();
      cachedSessionKey = data.session_key;
      return cachedSessionKey;
    } else {
      console.warn('[SECRETS] Failed to get session key:', res.status);
      sessionKeyFailed = true;
    }
  } catch (e) {
    console.warn('[SECRETS] Error getting session key:', e.message);
    sessionKeyFailed = true;
  }
  return null;
}

async function fetchDeviceSecrets(url, token, deviceId) {
  try {
    const sessionKey = await getSessionKey(url, token);
    if (!sessionKey) return null;

    const res = await fetch(`${url}/api/plugins/secrets/secrets/?assigned_object_id=${deviceId}`, {
      headers: {
        'Authorization': `Token ${token}`,
        'Accept': 'application/json',
        'X-Session-Key': sessionKey
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        // Find a secret that looks like a password or username
        // Heuristic: look for 'password', 'senha', or use the first one available
        const passwordSecret = data.results.find(s => s.name.toLowerCase().includes('password') || s.name.toLowerCase().includes('senha')) || data.results[0];
        const usernameSecret = data.results.find(s => s.name.toLowerCase().includes('username') || s.name.toLowerCase().includes('user') || s.name.toLowerCase().includes('login'));

        return {
          username: usernameSecret?.plaintext || null,
          password: passwordSecret?.plaintext || null
        };
      }
    }
  } catch (e) {
    console.warn(`[SECRETS] Error fetching secrets for device ${deviceId}:`, e.message);
  }
  return null;
}

// Helper to fetch config context if needed
async function fetchConfigContext(url, token, deviceId) {
  try {
    const res = await fetch(`${url}/api/dcim/devices/${deviceId}/config-context/`, { headers: authHeaders(token) });
    if (res.ok) return await res.json();
  } catch { }
  return null;
}

export async function syncFromNetbox(prisma, { url, token, resources = ["tenants", "devices"], tenantScopeId, deviceFilters, defaultCredentials = {} }) {
  if (!url || !token) throw new Error("NETBOX_URL/NETBOX_TOKEN ausentes");

  const result = { tenants: 0, devices: 0 };
  const GROUP_FILTER = process.env.NETBOX_TENANT_GROUP_FILTER || "K3G Solutions";
  let allowedTenants = new Set();

  if (resources.includes("tenants")) {
    const tenants = await fetchList(`${url}/api/tenancy/tenants/?limit=1000`, token);
    const filtered = tenants.filter((t) => {
      const gname = t?.group?.name || t?.tenant_group?.name || null;
      return !GROUP_FILTER || gname === GROUP_FILTER;
    });
    for (const t of filtered) {
      await prisma.tenant.upsert({
        where: { name: t.name },
        update: { description: t.description || null, tenantGroup: t?.group?.name || null },
        create: { name: t.name, description: t.description || null, tenantGroup: t?.group?.name || null },
      });
      allowedTenants.add(t.name);
      result.tenants++;
    }
  }
  // Ensure allowedTenants filter is populated when syncing devices only
  if (!resources.includes("tenants") && resources.includes("devices") && GROUP_FILTER) {
    const tenants = await fetchList(`${url}/api/tenancy/tenants/?limit=1000`, token).catch(() => []);
    for (const t of tenants) {
      const gname = t?.group?.name || t?.tenant_group?.name || null;
      if (gname === GROUP_FILTER) allowedTenants.add(t.name);
    }
  }

  if (resources.includes("devices")) {
    const devices = await fetchList(`${url}/api/dcim/devices/?limit=1000`, token);
    for (const d of devices) {
      const tenantName = d.tenant?.name || "NetBox";
      if (allowedTenants.size > 0 && !allowedTenants.has(tenantName)) {
        // Pula dispositivos cujo tenant não está no grupo filtrado
        continue;
      }
      // Filtros de função (device role) e plataforma
      const roleName = d.device_role?.name || d.role?.name || null;
      const platformName = d.platform?.name || null;
      const roles = deviceFilters?.roles;
      const platforms = deviceFilters?.platforms;
      const deviceTypes = deviceFilters?.deviceTypes;
      const sites = deviceFilters?.sites;
      if (Array.isArray(roles) && roles.length > 0) {
        if (!roleName || !roles.includes(roleName)) continue;
      }
      if (Array.isArray(platforms) && platforms.length > 0) {
        if (!platformName || !platforms.includes(platformName)) continue;
      }
      if (Array.isArray(deviceTypes) && deviceTypes.length > 0) {
        const typeName = d.device_type?.model || null;
        if (!typeName || !deviceTypes.includes(typeName)) continue;
      }
      if (Array.isArray(sites) && sites.length > 0) {
        const siteName = d.site?.name || null;
        if (!siteName || !sites.includes(siteName)) continue;
      }
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

      const ip = d.primary_ip?.address?.split("/")?.[0] || d.primary_ip4?.address?.split("/")?.[0] || "";
      const name = d.name || d.display || `Device-${d.id}`;

      // Custom Fields Mapping
      const cf = d.custom_fields || {};
      // Check both lowercase and capitalized just in case, and specific keys found in JSON
      const backupEnabled = !!(cf["Backup"] || cf["backup"]);
      const isProduction = !!(cf["Production"] || cf["production"]);
      const jumpserverId = cf["ID do Jumpserver"] || cf["jumpserver_id"] || cf["JS_DEVICE_ID"] || null;

      // Credentials Logic
      let credUsername = cf["username"] || cf["Username"] || null;
      let credPassword = cf["password"] || cf["Password"] || null;

      // If not in custom fields, try config_context from device object
      if (!credUsername && d.config_context) {
        credUsername = d.config_context.username || d.config_context.user || null;
        credPassword = d.config_context.password || d.config_context.pass || null;
      }

      // If still not found and we have an ID, try fetching rendered config context
      if (!credUsername && d.id) {
        const cc = await fetchConfigContext(url, token, d.id);
        if (cc) {
          credUsername = cc.username || cc.user || null;
          credPassword = cc.password || cc.pass || null;
        }
      }

      // Try fetching from Secrets Plugin (if key is available)
      if ((!credUsername || !credPassword) && d.id) {
        const secrets = await fetchDeviceSecrets(url, token, d.id);
        if (secrets) {
          if (!credUsername && secrets.username) credUsername = secrets.username;
          if (!credPassword && secrets.password) credPassword = secrets.password;
        }
      }

      // Fallback to Default Credentials (from Application config)
      if (!credUsername && defaultCredentials.username) credUsername = defaultCredentials.username;
      if (!credPassword && defaultCredentials.password) credPassword = defaultCredentials.password;

      // Determine Oxidized Model (Platform/Driver)
      const oxidizedModel = getOxidizedModel(d);

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
      };

      // Only update credentials if found in NetBox, otherwise keep existing
      if (credUsername) updateData.credUsername = credUsername;
      if (credPassword) {
        updateData.credPasswordEnc = encryptSecret(credPassword);
        updateData.credUpdatedAt = new Date();
      }

      // SSH Port
      // Assuming it might be in custom fields or standard port
      // NetBox doesn't have a standard ssh_port field on Device, so checking custom fields
      const sshPort = Number(cf["ssh_port"] || cf["SSH Port"] || 22);
      if (sshPort) updateData.sshPort = sshPort;

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

      result.devices++;
    }
  }

  return result;
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
