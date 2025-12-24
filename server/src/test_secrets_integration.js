import "./env.js";
import { getSessionKey } from './netboxClient.js';
import { getDeviceSecrets } from './netboxSecrets.js';

const NETBOX_URL = process.env.VITE_NETBOX_API_URL || process.env.NETBOX_URL;
const NETBOX_TOKEN = process.env.VITE_NETBOX_API_TOKEN || process.env.NETBOX_TOKEN;
const DEVICE_ID = 2647; // Use the known device ID

async function run() {
    console.log(`Testing NetBox Secrets Integration`);
    console.log(`URL: ${NETBOX_URL}`);

    if (!NETBOX_URL || !NETBOX_TOKEN) {
        console.error("Missing NETBOX_URL or NETBOX_TOKEN in .env");
        process.exit(1);
    }

    try {
        console.log("1. Testing Session Key Retrieval...");
        const sessionKey = await getSessionKey(NETBOX_URL, NETBOX_TOKEN);
        if (sessionKey) {
            console.log(`SUCCESS: Session Key obtained: ${sessionKey.substring(0, 10)}...`);
        } else {
            console.error("FAILURE: Could not obtain session key. Check private key.");
        }

        console.log(`2. Testing Secrets Fetching for Device ${DEVICE_ID}...`);
        const secrets = await getDeviceSecrets(DEVICE_ID, { url: NETBOX_URL, token: NETBOX_TOKEN });
        console.log("Secrets Result:", JSON.stringify(secrets, null, 2));

        if (secrets.password || secrets.username) {
            console.log("SUCCESS: Secrets found and decrypted.");
        } else {
            console.log("INFO: No secrets found or decrypted for this device (or naming convention mismatch).");
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

run();
