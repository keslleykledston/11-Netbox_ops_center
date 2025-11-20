import fetch from "node-fetch";

/**
 * Helper to build auth headers for Jumpserver
 * @param {string} token - Jumpserver API Token (or Key)
 */
function authHeaders(token) {
  // Jumpserver typically uses "Bearer <token>" or "Token <token>" depending on version.
  // Assuming "Token <token>" or "Bearer <token>" based on common practices.
  // Adjust if specific Jumpserver version requires different format (e.g. JMS signature).
  // For simple API tokens, often: Authorization: Token <token>
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Test connection to Jumpserver
 * @param {string} url - Base URL
 * @param {string} token - API Token
 */
export async function testJumpserverConnection(url, token) {
  try {
    // Simple endpoint to verify auth, e.g. /api/v1/users/users/ or /api/v1/assets/assets/
    const endpoint = `${url.replace(/\/$/, "")}/api/v1/users/users/?limit=1`;
    const res = await fetch(endpoint, { headers: authHeaders(token) });
    if (!res.ok) {
        // Try alternative endpoint if users is restricted
        const altEndpoint = `${url.replace(/\/$/, "")}/api/v1/assets/assets/?limit=1`;
        const altRes = await fetch(altEndpoint, { headers: authHeaders(token) });
        if (!altRes.ok) {
             throw new Error(`HTTP ${res.status} / ${altRes.status}`);
        }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Search for an asset by IP address
 * @param {string} url 
 * @param {string} token 
 * @param {string} ip 
 */
export async function findAssetByIp(url, token, ip) {
  // Search assets by IP
  const endpoint = `${url.replace(/\/$/, "")}/api/v1/assets/assets/?ip=${ip}`;
  const res = await fetch(endpoint, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Failed to search asset: HTTP ${res.status}`);
  const json = await res.json();
  // Jumpserver returns list
  if (Array.isArray(json) && json.length > 0) {
    return json[0]; // Return first match
  }
  // Pagination result structure?
  if (json.results && Array.isArray(json.results) && json.results.length > 0) {
      return json.results[0];
  }
  return null;
}

/**
 * Get connection URL (Web Terminal) for an asset
 * Note: Jumpserver API for getting a direct web terminal link might vary.
 * Usually it involves creating a session or constructing a URL to the Luna component.
 * 
 * Common pattern: https://<jms_url>/luna/connect/?asset=<asset_id>&user=<system_user_id>
 * Or via API to generate a token.
 * 
 * For this implementation, we will try to construct a standard Luna URL.
 */
export async function getConnectUrl(url, token, asset) {
    // We need a system user to connect as. 
    // If not provided, we might need to list system users and pick one, or let the user choose.
    // For simplicity, we'll try to find a system user linked to the asset or use a default one if configured.
    
    // Strategy:
    // 1. Just return the asset detail page or web terminal launch page if direct link is complex.
    // 2. Construct /luna/connect link.
    
    // Let's try to find system users for this asset.
    // GET /api/v1/assets/assets/:id/system-users/
    const sysUsersEndpoint = `${url.replace(/\/$/, "")}/api/v1/assets/assets/${asset.id}/system-users/`;
    const res = await fetch(sysUsersEndpoint, { headers: authHeaders(token) });
    let systemUserId = null;
    if (res.ok) {
        const sysUsers = await res.json();
        if (Array.isArray(sysUsers) && sysUsers.length > 0) {
            // Prefer 'web' protocol or just pick first
            systemUserId = sysUsers[0].id;
        }
    }

    // Construct URL
    // Format: <url>/luna/?asset=<id>
    // Or <url>/koko/connect/...
    
    // Standard Jumpserver Web Terminal (Luna):
    // http://<jms>/luna/?asset=<asset_id>
    // If system user is needed, it might prompt or we pass it.
    
    const baseUrl = url.replace(/\/$/, "");
    let connectUrl = `${baseUrl}/luna/?asset=${asset.id}`;
    if (systemUserId) {
        connectUrl += `&system_user=${systemUserId}`;
    }
    
    return connectUrl;
}
