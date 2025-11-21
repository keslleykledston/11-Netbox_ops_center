
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

const prisma = new PrismaClient();
const SNMP_SERVER_URL = process.env.SNMP_SERVER_URL || 'http://localhost:3001';

export async function processSnmpPolling(job) {
    const { deviceId } = job.data;

    try {
        const device = await prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) throw new Error(`Device ${deviceId} not found`);

        const params = new URLSearchParams({
            ip: device.ipAddress,
            community: device.snmpCommunity,
            port: String(device.snmpPort || 161),
        });

        const response = await fetch(`${SNMP_SERVER_URL}/api/snmp/ping?${params.toString()}`);

        let status = 'error';
        if (response.ok) {
            const data = await response.json();
            if (data.ok) status = 'ok';
        }

        await prisma.device.update({
            where: { id: deviceId },
            data: {
                snmpStatus: status,
                lastSnmpOk: status === 'ok' ? new Date() : undefined, // Only update timestamp if OK? Or keep old one? 
                // If status is ok, update timestamp. If error, keep old timestamp (last time it was ok).
                // Prisma update:
                ...(status === 'ok' ? { lastSnmpOk: new Date() } : {}),
            },
        });

        return { success: true, status };
    } catch (error) {
        console.error(`[SNMP-POLL] Failed for device ${deviceId}:`, error);
        // Update status to error on exception
        await prisma.device.update({
            where: { id: deviceId },
            data: { snmpStatus: 'error' },
        }).catch(() => { });
        throw error;
    }
}
