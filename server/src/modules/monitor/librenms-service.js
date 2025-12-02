/**
 * LibreNMS Service Module
 * Handles all interactions with LibreNMS API
 * Documentation: https://docs.librenms.org/API/
 */

import fetch from 'node-fetch';

const LIBRENMS_URL = process.env.LIBRENMS_URL || 'http://librenms:8000';
const LIBRENMS_API_TOKEN = process.env.LIBRENMS_API_TOKEN || '';

function isConfigured() {
  return Boolean(LIBRENMS_URL && LIBRENMS_API_TOKEN);
}

function normalizedBaseUrl() {
  if (!LIBRENMS_URL) return '';
  return LIBRENMS_URL.replace(/\/$/, '');
}

function authHeaders(extra = {}) {
  return {
    'X-Auth-Token': LIBRENMS_API_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function librenmsRequest(path, options = {}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'LIBRENMS_URL/API_TOKEN not configured' };
  }

  const base = normalizedBaseUrl();
  const url = `${base}${path}`;

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: authHeaders(options.headers || {}),
      body: options.body,
      timeout: options.timeout || 30000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LibreNMS HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }

    if (res.status === 204) return null;

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      return res.json();
    }
    return res.text();
  } catch (err) {
    console.error('[LIBRENMS] Request failed:', err.message);
    throw err;
  }
}

/**
 * Normalize device payload for LibreNMS
 */
function normalizeDevicePayload(device, tenantName = null) {
  // LibreNMS prefers hostname, but we use IP if hostname is missing
  const hostname = device.hostname || device.ipAddress;

  const payload = {
    hostname,
    display: device.name, // Display name in LibreNMS
    snmp_version: device.snmpVersion || 'v2c',
    port: device.snmpPort || 161,
    transport: 'udp',
  };

  // Add SNMP community for v1/v2c
  const version = (device.snmpVersion || '').toLowerCase();
  if (version.includes('v1') || version.includes('v2') || version.includes('2c')) {
    payload.community = device.snmpCommunity || 'public';
  }

  // Add SNMPv3 credentials if version is v3
  if (version.includes('v3')) {
    // TODO: Implement SNMPv3 credentials from device.customData
    payload.authlevel = 'authPriv';
    payload.authname = device.snmpV3User || '';
    payload.authpass = device.snmpV3AuthPass || '';
    payload.authalgo = device.snmpV3AuthAlgo || 'SHA';
    payload.cryptopass = device.snmpV3PrivPass || '';
    payload.cryptoalgo = device.snmpV3PrivAlgo || 'AES';
  }

  // Add location if available
  if (device.site) {
    payload.location = device.site;
  }

  // Add sysName override
  if (device.hostname) {
    payload.sysName = device.hostname;
  }

  // Add poller_group based on tenant (for organization/grouping in LibreNMS)
  if (tenantName) {
    payload.poller_group = tenantName;
  }

  console.log(`[LIBRENMS] Normalized payload for ${device.name}:`, JSON.stringify(payload, null, 2));

  return payload;
}

/**
 * Add device to LibreNMS
 * @param {Object} device - Device object from database
 * @param {string} tenantName - Tenant name for grouping (optional)
 * @returns {Promise<Object>} LibreNMS response
 */
export async function addDeviceToLibreNMS(device, tenantName = null) {
  if (!isConfigured()) {
    console.warn('[LIBRENMS] Not configured, skipping device add');
    return { skipped: true };
  }

  console.log(`[LIBRENMS] Adding device ${device.name} (${device.ipAddress}) to LibreNMS...`);
  console.log(`[LIBRENMS] SNMP Version: ${device.snmpVersion}, Community: ${device.snmpCommunity ? '***' : 'not set'}, Port: ${device.snmpPort || 161}`);

  try {
    const payload = normalizeDevicePayload(device, tenantName);

    const response = await librenmsRequest('/api/v0/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    console.log(`[LIBRENMS] ✅ Successfully added device ${device.name} (${device.ipAddress})`);
    console.log(`[LIBRENMS] Response:`, response);
    return {
      success: true,
      deviceId: response.device_id || response.id,
      message: response.message || 'Device added successfully',
    };
  } catch (err) {
    // If device already exists (409 conflict), try to get its ID
    if (err.message.includes('409') || err.message.includes('already exists')) {
      console.log(`[LIBRENMS] Device ${device.name} already exists, fetching ID...`);
      const existingDevice = await getDeviceByHostname(device.hostname || device.ipAddress);
      if (existingDevice) {
        console.log(`[LIBRENMS] Found existing device ID: ${existingDevice.device_id}`);
        return {
          success: true,
          deviceId: existingDevice.device_id,
          message: 'Device already exists',
          alreadyExists: true,
        };
      }
    }

    console.error(`[LIBRENMS] ❌ Failed to add device ${device.name}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Update device in LibreNMS
 * @param {number} libreNmsId - LibreNMS device ID
 * @param {Object} device - Updated device object
 * @param {string} tenantName - Tenant name for grouping (optional)
 * @returns {Promise<Object>} LibreNMS response
 */
export async function updateDeviceInLibreNMS(libreNmsId, device, tenantName = null) {
  if (!isConfigured()) return { skipped: true };

  console.log(`[LIBRENMS] Updating device ${device.name} (ID: ${libreNmsId})...`);

  try {
    const payload = normalizeDevicePayload(device, tenantName);

    const response = await librenmsRequest(`/api/v0/devices/${libreNmsId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    console.log(`[LIBRENMS] ✅ Successfully updated device ${device.name} (ID: ${libreNmsId})`);
    return { success: true, message: response.message || 'Device updated' };
  } catch (err) {
    console.error(`[LIBRENMS] ❌ Failed to update device ${device.name}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete device from LibreNMS
 * @param {number} libreNmsId - LibreNMS device ID
 * @returns {Promise<Object>} LibreNMS response
 */
export async function deleteDeviceFromLibreNMS(libreNmsId) {
  if (!isConfigured()) return { skipped: true };

  try {
    const response = await librenmsRequest(`/api/v0/devices/${libreNmsId}`, {
      method: 'DELETE',
    });

    console.log(`[LIBRENMS] Deleted device ID ${libreNmsId}`);
    return { success: true, message: response.message || 'Device deleted' };
  } catch (err) {
    console.error(`[LIBRENMS] Failed to delete device ${libreNmsId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get device by hostname from LibreNMS
 * @param {string} hostname - Device hostname or IP
 * @returns {Promise<Object|null>} Device object or null
 */
export async function getDeviceByHostname(hostname) {
  if (!isConfigured()) return null;

  try {
    const response = await librenmsRequest(`/api/v0/devices/${encodeURIComponent(hostname)}`);
    return response.devices && response.devices[0] ? response.devices[0] : null;
  } catch (err) {
    console.warn(`[LIBRENMS] Device ${hostname} not found`);
    return null;
  }
}

/**
 * Get device status from LibreNMS
 * @param {number} libreNmsId - LibreNMS device ID
 * @returns {Promise<Object>} Device status
 */
export async function getDeviceStatus(libreNmsId) {
  if (!isConfigured()) return { status: 'unknown', reason: 'LibreNMS not configured' };

  try {
    const response = await librenmsRequest(`/api/v0/devices/${libreNmsId}`);
    const device = response.devices && response.devices[0];

    if (!device) {
      return { status: 'unknown', error: 'Device not found' };
    }

    return {
      status: device.status === 1 ? 'up' : 'down',
      disabled: device.disabled === 1,
      uptime: device.uptime || 0,
      lastPolled: device.last_polled_timetaken || null,
      sysDescr: device.sysDescr || null,
      version: device.version || null,
    };
  } catch (err) {
    console.error(`[LIBRENMS] Failed to get status for device ${libreNmsId}:`, err.message);
    return { status: 'unknown', error: err.message };
  }
}

/**
 * Get status for multiple devices (batch)
 * @param {number[]} libreNmsIds - Array of LibreNMS device IDs
 * @returns {Promise<Map<number, Object>>} Map of device ID to status
 */
export async function getBatchDeviceStatus(libreNmsIds) {
  if (!isConfigured() || libreNmsIds.length === 0) {
    return new Map();
  }

  const statusMap = new Map();

  try {
    // LibreNMS doesn't have a batch endpoint, so we fetch all devices and filter
    const response = await librenmsRequest('/api/v0/devices');
    const devices = response.devices || [];

    for (const device of devices) {
      if (libreNmsIds.includes(device.device_id)) {
        statusMap.set(device.device_id, {
          status: device.status === 1 ? 'up' : 'down',
          disabled: device.disabled === 1,
          uptime: device.uptime || 0,
          lastPolled: device.last_polled_timetaken || null,
        });
      }
    }
  } catch (err) {
    console.error('[LIBRENMS] Failed to get batch device status:', err.message);
  }

  return statusMap;
}

/**
 * Get BGP peers for a device
 * @param {number} libreNmsId - LibreNMS device ID
 * @returns {Promise<Array>} Array of BGP peers
 */
export async function getDeviceBgpPeers(libreNmsId) {
  if (!isConfigured()) return [];

  try {
    const response = await librenmsRequest(`/api/v0/devices/${libreNmsId}/bgp`);
    const bgpPeers = response.bgp_peers || [];

    return bgpPeers.map(peer => ({
      ip: peer.bgpPeerIdentifier,
      asn: peer.bgpPeerRemoteAs,
      state: peer.bgpPeerState === 'established' ? 'up' : 'down',
      uptime: peer.bgpPeerFsmEstablishedTime || 0,
      adminStatus: peer.bgpPeerAdminStatus,
    }));
  } catch (err) {
    console.warn(`[LIBRENMS] Failed to get BGP peers for device ${libreNmsId}:`, err.message);
    return [];
  }
}

/**
 * Test LibreNMS connectivity
 * @returns {Promise<boolean>} True if LibreNMS is reachable
 */
export async function testLibreNMSConnection() {
  if (!isConfigured()) {
    return false;
  }

  try {
    const response = await librenmsRequest('/api/v0/system');
    return response && response.status === 'ok';
  } catch (err) {
    console.error('[LIBRENMS] Connection test failed:', err.message);
    return false;
  }
}

export function isLibreNMSAvailable() {
  return isConfigured();
}

export default {
  addDeviceToLibreNMS,
  updateDeviceInLibreNMS,
  deleteDeviceFromLibreNMS,
  getDeviceByHostname,
  getDeviceStatus,
  getBatchDeviceStatus,
  getDeviceBgpPeers,
  testLibreNMSConnection,
  isLibreNMSAvailable,
};
