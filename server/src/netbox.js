import fetch from "node-fetch";

function authHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function fetchList(url, token) {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`NetBox HTTP ${res.status}`);
  const json = await res.json();
  return json?.results || [];
}

export async function syncFromNetbox(prisma, { url, token, resources = ["tenants", "devices"], tenantScopeId, deviceFilters }) {
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
      if (Array.isArray(roles)) {
        if (roles.length === 0) continue; // filtro habilitado sem seleção -> não insere
        if (!roleName || !roles.includes(roleName)) continue;
      }
      if (Array.isArray(platforms)) {
        if (platforms.length === 0) continue; // filtro habilitado sem seleção -> não insere
        if (!platformName || !platforms.includes(platformName)) continue;
      }
      if (Array.isArray(deviceTypes)) {
        const typeName = d.device_type?.model || null;
        if (deviceTypes.length === 0) continue;
        if (!typeName || !deviceTypes.includes(typeName)) continue;
      }
      if (Array.isArray(sites)) {
        const siteName = d.site?.name || null;
        if (sites.length === 0) continue;
        if (!siteName || !sites.includes(siteName)) continue;
      }
      const tenant = await prisma.tenant.upsert({
        where: { name: tenantName },
        update: {},
        create: { name: tenantName },
      });

      const ip = d.primary_ip?.address?.split("/")?.[0] || d.primary_ip4?.address?.split("/")?.[0] || "";
      const name = d.name || d.display || `Device-${d.id}`;

      const existing = await prisma.device.findFirst({
        where: { name, tenantId: tenant.id },
      });

      if (existing) {
        await prisma.device.update({
          where: { id: existing.id },
          data: {
            hostname: d.name || null,
            ipAddress: ip || existing.ipAddress,
            manufacturer: "NetBox",
            model: d.device_type?.model || "unknown",
            status: d.status?.value || "inactive",
          },
        });
      } else {
        await prisma.device.create({
          data: {
            tenantId: tenant.id,
            name,
            hostname: d.name || null,
            ipAddress: ip || "0.0.0.0",
            deviceType: "router",
            manufacturer: "NetBox",
            model: d.device_type?.model || "unknown",
            status: d.status?.value || "inactive",
          },
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
