import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} NetBoxConfig
 * @property {string} url
 * @property {string} token
 */

let cachedSessionKey = null;
let sessionKeyFailed = false;

/**
 * Reads the private key from the filesystem.
 * @returns {string|null} The private key or null if not found.
 */
function getPrivateKey() {
    try {
        // Try to find the private key in common locations
        const paths = [
            path.join(__dirname, 'netbox_private_key.pem'), // Priority: same dir as client (src)
            path.join(__dirname, '../netbox_private_key.pem'), // server root
            path.join(__dirname, '../../netbox_private_key.pem'), // project root
            process.env.NETBOX_PRIVATE_KEY_PATH
        ];

        for (const p of paths) {
            if (p && fs.existsSync(p)) {
                const key = fs.readFileSync(p, 'utf8');
                // Ensure newline at end if missing
                return key.endsWith('\n') ? key : key + '\n';
            }
        }
    } catch (e) {
        console.warn('[NetBoxClient] Error reading private key:', e.message);
    }
    return null;
}

/**
 * Fetches a new session key from NetBox.
 * @param {string} url 
 * @param {string} token 
 * @returns {Promise<string|null>}
 */
async function fetchSessionKey(url, token) {
    const privateKey = getPrivateKey();
    if (!privateKey) {
        console.warn('[NetBoxClient] No private key found. Secrets will not be decrypted.');
        return null;
    }

    try {
        console.log('[NetBoxClient] Requesting new session key...');
        const res = await fetch(`${url}/api/plugins/secrets/session-keys/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ private_key: privateKey, preserve_key: true })
        });

        if (res.ok) {
            const data = await res.json();
            console.log('[NetBoxClient] Session key obtained successfully.');
            return data.session_key;
        } else {
            console.warn(`[NetBoxClient] Failed to get session key. Status: ${res.status}`);
            const text = await res.text();
            console.warn(`[NetBoxClient] Response: ${text}`);
        }
    } catch (e) {
        console.warn('[NetBoxClient] Error fetching session key:', e.message);
    }
    return null;
}

/**
 * Gets a valid session key, renewing if necessary.
 * @param {string} url 
 * @param {string} token 
 * @param {boolean} forceRenew 
 * @returns {Promise<string|null>}
 */
export async function getSessionKey(url, token, forceRenew = false) {
    if (cachedSessionKey && !forceRenew) return cachedSessionKey;
    if (sessionKeyFailed && !forceRenew) return null; // Avoid spamming if it failed permanently (e.g. no key)

    const key = await fetchSessionKey(url, token);
    if (key) {
        cachedSessionKey = key;
        sessionKeyFailed = false;
    } else {
        sessionKeyFailed = true;
    }
    return key;
}

/**
 * Creates a configured fetch wrapper for NetBox API calls.
 * Automatically handles Session Key injection and renewal on 401/403.
 * @param {NetBoxConfig} config 
 */
export function getNetboxClient({ url, token }) {
    return {
        /**
         * Performs a fetch request to NetBox.
         * @param {string} endpoint Relative path (e.g. '/api/dcim/devices/')
         * @param {Object} [options] Fetch options
         */
        request: async (endpoint, options = {}) => {
            const fullUrl = `${url}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

            // Ensure headers exist
            options.headers = options.headers || {};
            options.headers['Authorization'] = `Token ${token}`;
            options.headers['Accept'] = 'application/json';
            options.headers['Content-Type'] = 'application/json';

            // Inject Session Key if available
            let sessionKey = await getSessionKey(url, token);
            if (sessionKey) {
                options.headers['X-Session-Key'] = sessionKey;
            }

            let res = await fetch(fullUrl, options);

            // Handle potential session key expiration (403 Forbidden usually for secrets)
            if (res.status === 403 && sessionKey) {
                console.warn('[NetBoxClient] 403 Forbidden. Trying to renew session key...');
                sessionKey = await getSessionKey(url, token, true); // Force renew
                if (sessionKey) {
                    options.headers['X-Session-Key'] = sessionKey;
                    res = await fetch(fullUrl, options); // Retry request
                }
            }

            return res;
        },

        get: async (endpoint) => {
            return getNetboxClient({ url, token }).request(endpoint, { method: 'GET' });
        }
    };
}
