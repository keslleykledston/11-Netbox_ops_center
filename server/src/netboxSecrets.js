import { getNetboxClient } from './netboxClient.js';

/**
 * @typedef {Object} DeviceSecrets
 * @property {string|null} username
 * @property {string|null} password
 * @property {number|null} sshPort
 */

/**
 * Fetches and extracts secrets for a specific device.
 * @param {number} deviceId 
 * @param {Object} config 
 * @param {string} config.url 
 * @param {string} config.token 
 * @returns {Promise<DeviceSecrets>}
 */
export async function getDeviceSecrets(deviceId, { url, token }) {
    const client = getNetboxClient({ url, token });
    const secrets = { username: null, password: null, sshPort: null };

    try {
        // Fetch secrets assigned to this device
        const res = await client.request(`/api/plugins/secrets/secrets/?assigned_object_type=dcim.device&assigned_object_id=${deviceId}`);

        if (!res.ok) {
            console.warn(`[NetBoxSecrets] Failed to fetch secrets for device ${deviceId}: ${res.status}`);
            return secrets;
        }

        const data = await res.json();
        if (data.results && data.results.length > 0) {
            // Priority 1: For Jumpserver role (JS), use jumpserver.k3g specifically
            const jumpserverSecret = data.results.find(s =>
                s.role?.name?.toLowerCase() === 'js' && s.name === 'jumpserver.k3g'
            );

            if (jumpserverSecret && jumpserverSecret.plaintext) {
                secrets.username = 'jumpserver.k3g';
                secrets.password = jumpserverSecret.plaintext;
                console.log(`[NetBoxSecrets] Device ${deviceId} - Using Jumpserver credentials`);
                return secrets;
            }

            // Priority 2: Look for other credential patterns
            for (const secret of data.results) {
                if (!secret.plaintext) continue;

                const name = (secret.name || '').toLowerCase();
                const role = (secret.role?.name || '').toLowerCase();

                // Check role-based mapping
                if (role.includes('password') || role.includes('senha')) {
                    if (!secrets.password) secrets.password = secret.plaintext;
                } else if (role.includes('username') || role.includes('user') || role.includes('login')) {
                    if (!secrets.username) secrets.username = secret.plaintext;
                }
                // Check name-based mapping
                else if (name.includes('password') || name.includes('senha')) {
                    if (!secrets.password) secrets.password = secret.plaintext;
                } else if (name.includes('username') || name.includes('user') || name.includes('login')) {
                    if (!secrets.username) secrets.username = secret.plaintext;
                } else if (name.includes('ssh') && name.includes('port')) {
                    const port = parseInt(secret.plaintext, 10);
                    if (!isNaN(port)) secrets.sshPort = port;
                }
                // Fallback: if JS role but not jumpserver.k3g, use the secret name as username
                else if (role === 'js' && !secrets.username) {
                    secrets.username = secret.name; // e.g., "keslley" or "suporte.k3g"
                    secrets.password = secret.plaintext;
                }
            }

            if (Object.values(secrets).some(v => v !== null)) {
                console.log(`[NetBoxSecrets] Device ${deviceId} - Found credentials from secrets plugin`);
            }
        }
    } catch (e) {
        console.warn(`[NetBoxSecrets] Error fetching secrets for device ${deviceId}:`, e.message);
    }

    return secrets;
}

/**
 * Fetches ALL potential credentials for a device.
 * @param {number} deviceId 
 * @param {Object} config 
 * @returns {Promise<Array<{username: string, password: string, source: string}>>}
 */
export async function getAllDeviceSecrets(deviceId, { url, token }) {
    const client = getNetboxClient({ url, token });
    const credentials = [];

    try {
        const res = await client.request(`/api/plugins/secrets/secrets/?assigned_object_type=dcim.device&assigned_object_id=${deviceId}`);

        if (!res.ok) return [];

        const data = await res.json();
        if (data.results) {
            // Group by role or name pattern
            // Strategy: Treat each secret as a potential password if it has a username-like counterpart
            // OR if it's a standalone credential set (like Jumpserver ones often are, though NetBox secrets are usually single fields)

            // Actually, NetBox Secrets are individual fields. We need to pair them.
            // Common patterns:
            // 1. Role: "username", "password" -> Pair them
            // 2. Name: "username", "password" -> Pair them
            // 3. Role: "JS" -> usually implies a specific username/password pair if multiple secrets exist for that role?
            //    Wait, in the debug output we saw:
            //    Secret 1: Name: jumpserver.k3g, Role: JS, Plaintext: ***
            //    Secret 2: Name: keslley, Role: JS, Plaintext: ***
            //    Secret 3: Name: suporte.k3g, Role: JS, Plaintext: ***

            // It seems for "JS" role, the NAME is the username and the PLAINTEXT is the password?
            // Let's assume that for now based on the user's "os que tem role JS, deve usar o login jumpserver.k3g" comment
            // actually the user said: "os que tem role JS, deve usar o login jumpserver.k3g"
            // BUT also "tem tambem possibilidade de usar os demais em paralelo"
            // This implies that "keslley" and "suporte.k3g" are ALSO valid usernames, and their plaintext is their password.

            for (const secret of data.results) {
                if (!secret.plaintext) continue;

                const name = (secret.name || '').toLowerCase();
                const role = (secret.role?.name || '').toLowerCase();

                // Case 1: JS Role - assume Name = Username, Plaintext = Password
                // UNLESS the user specifically said "use login jumpserver.k3g" for JS role?
                // The user said: "os que tem role JS, deve usar o login jumpserver.k3g"
                // This might mean: If role is JS, the username is ALWAYS jumpserver.k3g?
                // AND the password is the plaintext?
                // But we have 3 secrets with role JS. Do they all use username jumpserver.k3g?
                // Or is one of them THE jumpserver credential?
                // "jumpserver.k3g" is the name of one secret.

                // Let's support the specific Jumpserver one first
                if (role === 'js' && name === 'jumpserver.k3g') {
                    credentials.push({
                        username: 'jumpserver.k3g',
                        password: secret.plaintext,
                        source: 'NetBox Secret (Jumpserver)'
                    });
                }
                // Then support others as potential credentials
                else if (role === 'js') {
                    // Assume Secret Name = Username, Plaintext = Password
                    credentials.push({
                        username: secret.name,
                        password: secret.plaintext,
                        source: `NetBox Secret (${secret.name})`
                    });
                }
                // Generic fallback for other roles
                else if (name.includes('password') || role.includes('password')) {
                    // This is just a password field. We need a username.
                    // Look for a corresponding username field?
                    // For now, let's skip complex pairing unless we see it.
                }
            }
        }
    } catch (e) {
        console.warn(`[NetBoxSecrets] Error fetching all secrets for device ${deviceId}:`, e.message);
    }

    return credentials;
}

