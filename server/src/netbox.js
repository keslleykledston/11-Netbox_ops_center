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
    // Fetch all services upfront
    const servicesMap = await fetchAllServices(url, token);

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

      // Try fetching from Secrets Plugin (using new module)
      if ((!credUsername || !credPassword) && d.id) {
        const secrets = await getDeviceSecrets(d.id, { url, token });
        if (secrets) {
          if (!credUsername && secrets.username) credUsername = secrets.username;
          if (!credPassword && secrets.password) credPassword = secrets.password;
          // Also update SSH port if found in secrets and not yet set
          if (!sshPort && secrets.sshPort) sshPort = secrets.sshPort;
        }
      }

      // Fallback to Default Credentials (from Application config)
      if (!credUsername && defaultCredentials.username) credUsername = defaultCredentials.username;
      if (!credPassword && defaultCredentials.password) credPassword = defaultCredentials.password;

      // Fetch Services (SSH/Telnet ports) from Map
      let sshPort = null;
      if (d.id) {
        const services = servicesMap.get(d.id);
        if (services?.sshPort) {
          sshPort = services.sshPort;
        }
      }

      // Fallback to Custom Fields if Services didn't have SSH port
      if (!sshPort) {
        sshPort = Number(cf["ssh_port"] || cf["SSH Port"] || 22);
      }

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
        sshPort, // Use the port extracted from Services or Custom Fields
      };

      // Only update credentials if found in NetBox, otherwise keep existing
      if (credUsername) updateData.credUsername = credUsername;
      if (credPassword) {
        updateData.credPasswordEnc = encryptSecret(credPassword);
        updateData.credUpdatedAt = new Date();
      }

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
