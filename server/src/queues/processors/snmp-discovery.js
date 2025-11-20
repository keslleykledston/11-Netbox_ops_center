// SNMP Discovery Job Processor
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

const prisma = new PrismaClient();
const SNMP_SERVER_URL = process.env.SNMP_SERVER_URL || 'http://localhost:3001';

export async function processSnmpDiscovery(job) {
  const { deviceId, discoveryType, userId, tenantId } = job.data;

  try {
    // Get device
    await job.updateProgress(10);
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    await job.log(`Starting ${discoveryType} discovery for device: ${device.name}`);
    await job.updateProgress(20);

    // Perform SNMP discovery
    const endpoint = discoveryType === 'interfaces' ? '/snmp/interfaces' : '/snmp/bgp-peers';
    const response = await fetch(`${SNMP_SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ipAddress: device.ipAddress,
        snmpVersion: device.snmpVersion || 'v2c',
        snmpCommunity: device.snmpCommunity,
        snmpPort: device.snmpPort || 161,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SNMP discovery failed: ${errorText}`);
    }

    const payload = await response.json();
    const discovered = Array.isArray(payload)
      ? payload
      : discoveryType === 'interfaces'
        ? (payload.interfaces || [])
        : (payload.peers || []);
    await job.updateProgress(60);
    await job.log(`Discovered ${discovered.length || 0} ${discoveryType}`);

    // Save to database
    if (discoveryType === 'interfaces') {
      // Delete old interfaces for this device
      await prisma.discoveredInterface.deleteMany({
        where: { deviceId },
      });

      // Insert new interfaces
      if (discovered.length > 0) {
        await prisma.discoveredInterface.createMany({
          data: discovered.map(iface => ({
            tenantId: device.tenantId,
            deviceId: device.id,
            deviceName: device.name,
            ifIndex: String(iface.ifIndex),
            ifName: iface.ifName,
            ifDesc: iface.ifDesc,
            ifType: iface.ifType,
          })),
        });
      }
    } else {
      // Delete old peers for this device
      await prisma.discoveredBgpPeer.deleteMany({
        where: { deviceId },
      });

      // Insert new peers
      if (payload.localAsn) {
        await prisma.device.update({ where: { id: device.id }, data: { localAsn: Number(payload.localAsn) } }).catch(() => {});
      }
      if (discovered.length > 0) {
        await prisma.discoveredBgpPeer.createMany({
          data: discovered.map(peer => ({
            tenantId: device.tenantId,
            deviceId: device.id,
            deviceName: device.name,
            ipPeer: peer.ipPeer,
            asn: peer.asn,
            localAsn: peer.localAsn || device.localAsn,
            name: peer.name,
            vrfName: peer.vrfName,
          })),
        });
      }
    }

    await job.updateProgress(100);
    await job.log('Discovery completed successfully');

    return {
      success: true,
      deviceId,
      discoveryType,
      count: discovered.length || 0,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('SNMP discovery job failed:', error);
    await job.log(`Error: ${error.message}`);
    throw error;
  }
}
