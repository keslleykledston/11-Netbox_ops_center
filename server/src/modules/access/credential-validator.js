import { getAllDeviceSecrets } from '../../netboxSecrets.js';
import { checkSshConnection } from './ssh-check.js';
import { getNetboxClient } from '../../netboxClient.js';

/**
 * Validates all available credentials for a device against its SSH service.
 * @param {Object} prisma - Prisma Client instance
 * @param {number} deviceId - ID of the device to validate
 * @param {Object} netboxConfig - { url, token }
 * @returns {Promise<{results: Array<{username: string, status: string, error?: string, source: string}>, best: Object|null}>}
 */
export async function validateDeviceCredentials(prisma, deviceId, netboxConfig) {
    console.log(`[CredentialValidator] Starting validation for device ${deviceId}`);

    // 1. Fetch Device Details
    const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, ipAddress: true, sshPort: true }
    });

    if (!device) {
        throw new Error(`Device ${deviceId} not found`);
    }

    if (!device.ipAddress) {
        return { results: [], best: null, error: 'No IP address' };
    }

    // 2. Resolve NetBox ID
    let netboxId = null;
    try {
        const client = getNetboxClient(netboxConfig);
        const res = await client.request(`/api/dcim/devices/?name=${encodeURIComponent(device.name)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                netboxId = data.results[0].id;
                console.log(`[CredentialValidator] Resolved NetBox ID for ${device.name}: ${netboxId}`);
            }
        }
    } catch (e) {
        console.warn(`[CredentialValidator] Failed to resolve NetBox ID: ${e.message}`);
    }

    if (!netboxId) {
        console.warn(`[CredentialValidator] Could not find device ${device.name} in NetBox`);
        return { results: [], best: null, error: 'NetBox ID not found' };
    }

    // 3. Fetch All Potential Secrets
    const secrets = await getAllDeviceSecrets(netboxId, netboxConfig);

    if (secrets.length === 0) {
        console.log(`[CredentialValidator] No secrets found for device ${device.name} (NetBox ID: ${netboxId})`);
        return { results: [], best: null };
    }

    console.log(`[CredentialValidator] Found ${secrets.length} potential credentials for ${device.name}`);

    // 4. Test Each Credential
    const results = [];
    let bestCredential = null;

    for (const secret of secrets) {
        console.log(`[CredentialValidator] Testing ${secret.username}...`);

        const check = await checkSshConnection(
            device.ipAddress,
            device.sshPort || 22,
            secret.username,
            secret.password
        );

        const result = {
            username: secret.username,
            source: secret.source,
            status: check.ok ? 'success' : 'failed',
            error: check.error
        };

        results.push(result);

        if (check.ok && !bestCredential) {
            bestCredential = secret;
        }
    }

    // 5. Report Results
    const successes = results.filter(r => r.status === 'success');
    const failures = results.filter(r => r.status === 'failed');

    console.log(`[CredentialValidator] Validation complete for ${device.name}`);
    console.log(`  Successes: ${successes.length}`);
    console.log(`  Failures: ${failures.length}`);

    return {
        device: { id: device.id, name: device.name },
        results,
        best: bestCredential,
        summary: {
            total: results.length,
            success: successes.length,
            failed: failures.length
        }
    };
}
