import { getNetboxClient } from '../../netboxClient.js';
import fetch from 'node-fetch';

function authHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function fetchAll(url, token) {
  const out = [];
  let nextUrl = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: authHeaders(token) });
    if (!res.ok) {
      throw new Error(`NetBox HTTP ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data?.results)) {
      out.push(...data.results);
    }
    nextUrl = data.next || null;

    if (nextUrl && url.startsWith('https://') && nextUrl.startsWith('http://')) {
      nextUrl = nextUrl.replace('http://', 'https://');
    }
  }
  return out;
}

export async function fetchNetboxTenants(url, token) {
  return fetchAll(`${url}/api/tenancy/tenants/?limit=1000`, token);
}

export async function fetchNetboxDevices(url, token) {
  return fetchAll(`${url}/api/dcim/devices/?limit=1000`, token);
}

export async function updateNetboxDeviceCustomField(url, token, deviceId, fieldName, value) {
  const client = getNetboxClient({ url, token });
  const payload = {
    custom_fields: {
      [fieldName]: value,
    },
  };
  const res = await client.request(`/api/dcim/devices/${deviceId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NetBox update failed (${res.status}): ${text}`);
  }
  return res.json();
}
