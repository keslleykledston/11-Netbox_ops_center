import fetch from 'node-fetch';
import "dotenv/config";

const CHECKMK_URL = process.env.CHECKMK_URL || '';
const CHECKMK_USERNAME = process.env.CHECKMK_USERNAME || '';
const CHECKMK_PASSWORD = process.env.CHECKMK_PASSWORD || '';

const devices = [
    { name: 'Test-Creds-Device-2', ip: '192.168.99.102' },
    { name: 'INFORR-BVB-JCL-RX', ip: '138.219.128.1' },
    { name: '4WNET-BVA-BRT-R:X_NE8000', ip: '45.169.161.255' },
];

async function checkHost(hostname) {
    const basic = Buffer.from(`${CHECKMK_USERNAME}:${CHECKMK_PASSWORD}`).toString('base64');
    const sanitized = hostname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const url = `${CHECKMK_URL}/check_mk/api/1.0/domain-types/host_config/objects/${encodeURIComponent(sanitized)}`;

    try {
        const res = await fetch(url, {
            headers: {
                Authorization: `Basic ${basic}`,
                Accept: 'application/json',
            },
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`✓ Host ${sanitized} exists`);
            console.log(`  IP: ${data.extensions?.attributes?.ipaddress || 'N/A'}`);
            console.log(`  SNMP: ${data.extensions?.attributes?.snmp_community ? 'Configured' : 'Not configured'}`);
            return true;
        } else {
            console.log(`✗ Host ${sanitized} NOT FOUND (${res.status})`);
            return false;
        }
    } catch (error) {
        console.log(`✗ Error checking ${sanitized}:`, error.message);
        return false;
    }
}

async function main() {
    console.log('Checking Checkmk hosts...\n');
    for (const device of devices) {
        console.log(`Checking: ${device.name} → ${device.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`);
        await checkHost(device.name);
        console.log('');
    }
}

main().catch(console.error);
