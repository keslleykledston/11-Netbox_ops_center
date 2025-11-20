import fetch from 'node-fetch';

const CHECKMK_URL = process.env.CHECKMK_URL || '';
const CHECKMK_SITE = process.env.CHECKMK_SITE || 'netbox';
const CHECKMK_USERNAME = process.env.CHECKMK_USERNAME || '';
const CHECKMK_PASSWORD = process.env.CHECKMK_PASSWORD || '';

function isConfigured() {
  return Boolean(CHECKMK_URL && CHECKMK_USERNAME && CHECKMK_PASSWORD);
}

function normalizedBaseUrl() {
  if (!CHECKMK_URL) return '';
  return CHECKMK_URL.replace(/\/$/, '');
}

function authHeaders(extra = {}) {
  const basic = Buffer.from(`${CHECKMK_USERNAME}:${CHECKMK_PASSWORD}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function checkmkRequest(path, options = {}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'CHECKMK_URL/username/password not configured' };
  }
  const base = normalizedBaseUrl();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: authHeaders(options.headers || {}),
    body: options.body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Checkmk HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    return res.json();
  }
  return res.text();
}

function normalizeHostPayload(device) {
  return {
    folder: '/',
    host_name: device.name,
    attributes: {
      ipaddress: device.ipAddress,
      alias: device.hostname || device.name,
      tags: device.deviceType ? { device_type: device.deviceType } : undefined,
    },
  };
}

export async function addHostToCheckmk(device) {
  if (!isConfigured()) return { skipped: true };
  const payload = normalizeHostPayload(device);
  return checkmkRequest(`/check_mk/api/1.0/domain-types/host_config/objects/${encodeURIComponent(device.name)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function updateHostInCheckmk(_deviceId, device) {
  if (!isConfigured()) return { skipped: true };
  const payload = normalizeHostPayload(device);
  return checkmkRequest(`/check_mk/api/1.0/domain-types/host_config/objects/${encodeURIComponent(device.name)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteHostFromCheckmk(deviceIdOrName) {
  if (!isConfigured()) return { skipped: true };
  const hostName = typeof deviceIdOrName === 'string' ? deviceIdOrName : String(deviceIdOrName);
  return checkmkRequest(`/check_mk/api/1.0/domain-types/host_config/objects/${encodeURIComponent(hostName)}`, {
    method: 'DELETE',
  });
}

export async function activateChanges() {
  if (!isConfigured()) return { skipped: true };
  try {
    return await checkmkRequest(`/check_mk/api/1.0/domain-types/activation_run/actions/activate-changes/invoke`, {
      method: 'POST',
      body: JSON.stringify({
        force_foreign_changes: false,
        sites: [CHECKMK_SITE],
      }),
    });
  } catch (err) {
    console.warn('[CHECKMK] Failed to activate changes:', err.message);
    return { error: err.message };
  }
}

function parseState(state) {
  if (state === 0 || state === 'UP') return 'up';
  if (state === 1 || state === 'DOWN') return 'down';
  if (state === 2) return 'unreachable';
  return 'unknown';
}

export async function getHostsStatus(hostnames = []) {
  if (!isConfigured() || hostnames.length === 0) return {};
  const statusMap = {};
  for (const host of hostnames) {
    try {
      const data = await checkmkRequest(`/check_mk/api/1.0/domain-types/host/objects/${encodeURIComponent(host)}`, {
        method: 'GET',
      });
      const state = data?.extensions?.attributes?.state ?? data?.extensions?.status?.state ?? null;
      const lastCheck = data?.extensions?.status?.last_check ?? null;
      statusMap[host] = {
        state: parseState(state),
        lastCheck,
      };
    } catch (err) {
      statusMap[host] = { state: 'unknown', error: err.message };
    }
  }
  return statusMap;
}

export function isCheckmkAvailable() {
  return isConfigured();
}
