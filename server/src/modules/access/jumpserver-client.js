// Jumpserver Client - API Integration
// Handles communication with Jumpserver REST API and WebSocket (Koko protocol)

import nodeFetch from 'node-fetch';
import Redis from 'ioredis';

const LOGIN_DELAY_MIN_MS = 3000;
const LOGIN_DELAY_MAX_MS = 5000;
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;
const DEFAULT_TOKEN_TTL_MS = 55 * 60 * 1000;
const REDIS_URL = process.env.REDIS_URL || null;
const REDIS_KEY_PREFIX = 'jumpserver:token:';

const tokenCache = new Map();
const loginInFlight = new Map();
let redisClient = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLoginDelayMs() {
    const span = Math.max(0, LOGIN_DELAY_MAX_MS - LOGIN_DELAY_MIN_MS);
    return LOGIN_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
}

function buildCacheKey({ baseUrl, username, organizationId }) {
    if (!baseUrl || !username) return null;
    return `${baseUrl}::${username}::${organizationId || ''}`;
}

function getRedisClient() {
    if (!REDIS_URL) return null;
    if (!redisClient) {
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
        });
        redisClient.on('error', (err) => {
            console.warn('[Jumpserver][WARN] Redis error:', err?.message || err);
        });
    }
    return redisClient;
}

function redisTokenKey(cacheKey) {
    const encoded = Buffer.from(String(cacheKey), 'utf8').toString('base64url');
    return `${REDIS_KEY_PREFIX}${encoded}`;
}

function normalizeBase64Url(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    return `${normalized}${'='.repeat(padLength)}`;
}

function decodeJwtExpMs(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length < 2) return null;
        const payload = normalizeBase64Url(parts[1]);
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        const data = JSON.parse(decoded);
        if (data && typeof data.exp === 'number') {
            return data.exp * 1000;
        }
        return null;
    } catch {
        return null;
    }
}

function resolveExpiresAtMs(loginResponse, token) {
    const now = Date.now();
    const expFromJwt = decodeJwtExpMs(token);
    if (expFromJwt) return expFromJwt;
    if (loginResponse && Number.isFinite(Number(loginResponse.expires_in))) {
        return now + Number(loginResponse.expires_in) * 1000;
    }
    if (loginResponse && Number.isFinite(Number(loginResponse.expire_in))) {
        return now + Number(loginResponse.expire_in) * 1000;
    }
    if (loginResponse && Number.isFinite(Number(loginResponse.expired_at))) {
        return Number(loginResponse.expired_at) * 1000;
    }
    if (loginResponse && Number.isFinite(Number(loginResponse.expire_at))) {
        return Number(loginResponse.expire_at) * 1000;
    }
    return now + DEFAULT_TOKEN_TTL_MS;
}

async function readCachedToken(cacheKey) {
    if (!cacheKey) return null;
    const entry = tokenCache.get(cacheKey);
    if (entry) {
        if (entry.expiresAt && Date.now() >= entry.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
            tokenCache.delete(cacheKey);
        } else {
            return entry;
        }
    }

    const client = getRedisClient();
    if (!client) return null;
    try {
        const raw = await client.get(redisTokenKey(cacheKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.token) return null;
        if (parsed.expiresAt && Date.now() >= parsed.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
            await client.del(redisTokenKey(cacheKey));
            return null;
        }
        tokenCache.set(cacheKey, parsed);
        return parsed;
    } catch {
        return null;
    }
}

async function writeCachedToken(cacheKey, entry) {
    if (!cacheKey || !entry?.token) return;
    tokenCache.set(cacheKey, entry);
    const client = getRedisClient();
    if (!client) return;
    const ttlMs = entry.expiresAt
        ? Math.max(1, entry.expiresAt - Date.now())
        : DEFAULT_TOKEN_TTL_MS;
    try {
        await client.set(redisTokenKey(cacheKey), JSON.stringify(entry), 'PX', ttlMs);
    } catch {
        // best-effort cache
    }
}

/**
 * Jumpserver API Client
 * Documentation: https://docs.jumpserver.org/zh/v3/dev/rest_api/
 */
export class JumpserverClient {
    constructor({ baseUrl, apiToken, organizationId = null, username = null, password = null }) {
        this.baseUrl = String(baseUrl || "").trim().replace(/\/$/, ''); // Remove trailing slash
        this.apiToken = apiToken ? String(apiToken).trim() : null;
        this.organizationId = organizationId;
        this.username = username ? String(username).trim() : null;
        this.password = password ? String(password).trim() : null;
        this.jwtToken = null;
        this.authenticated = false;
        this.tokenType = 'Token';
        this.cacheKey = buildCacheKey({
            baseUrl: this.baseUrl,
            username: this.username,
            organizationId: this.organizationId,
        });
        this.loadCachedTokenSync();
    }

    /**
     * Make authenticated HTTP request to Jumpserver API
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const makeHeaders = (token, tokenType) => {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers,
            };
            if (token) {
                headers['Authorization'] = `${tokenType} ${token}`;
            }
            if (this.organizationId) {
                headers['X-JMS-ORG'] = this.organizationId;
            }
            return headers;
        };

        const resolveToken = () => {
            if (this.jwtToken) return { token: this.jwtToken, type: 'Bearer' };
            if (this.apiToken) return { token: this.apiToken, type: this.tokenType || 'Token' };
            return { token: '', type: this.tokenType || 'Token' };
        };

        const doRequest = async (tokenOverride = null, typeOverride = null) => {
            const resolved = resolveToken();
            const token = tokenOverride || resolved.token;
            const type = typeOverride || resolved.type;
            return await nodeFetch(url, {
                ...options,
                headers: makeHeaders(token, type),
            });
        };

        try {
            await this.loadCachedToken();
            const canLogin = this.username && this.password;
            if (!this.apiToken && !this.jwtToken && canLogin) {
                await this.login();
            }
            let response = await doRequest();
            if (response.status === 401 && this.apiToken) {
                const currentType = (this.tokenType || 'Token').toLowerCase();
                const altType = currentType === 'bearer' ? 'Token' : 'Bearer';
                response = await doRequest(this.apiToken, altType);
                if (response.ok) {
                    this.tokenType = altType;
                }
            }
            if (response.status === 401 && canLogin) {
                await this.login({ force: true });
                response = await doRequest();
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Jumpserver API error (${response.status}): ${errorText}`);
            }

            // Handle empty responses (204 No Content)
            if (response.status === 204) {
                return null;
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }

            return await response.text();
        } catch (error) {
            if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                throw new Error(`Jumpserver não acessível em ${this.baseUrl}`);
            }
            throw error;
        }
    }

    /**
     * Test authentication and connectivity
     */
    async authenticate() {
        try {
            // Test with /api/v1/users/profile/ endpoint
            const profile = await this.request('/api/v1/users/profile/');
            this.authenticated = true;
            return {
                success: true,
                user: profile,
            };
        } catch (error) {
            this.authenticated = false;
            throw new Error(`Falha na autenticação: ${error.message}`);
        }
    }

    /**
     * Login with username/password to get JWT token
     */
    async login({ force = false } = {}) {
        if (!this.username || !this.password) return null;
        if (!force) {
            const cached = await readCachedToken(this.cacheKey);
            if (cached?.token) {
                this.jwtToken = cached.token;
                this.authenticated = true;
                return cached.token;
            }
        }
        const inflight = this.cacheKey ? loginInFlight.get(this.cacheKey) : null;
        if (inflight) {
            const token = await inflight;
            if (token) {
                this.jwtToken = token;
                this.authenticated = true;
            }
            return token;
        }

        const loginPromise = (async () => {
            const response = await nodeFetch(`${this.baseUrl}/api/v1/authentication/auth/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    username: this.username,
                    password: this.password,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Jumpserver auth error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            const token = data?.token || null;
            if (token) {
                await sleep(randomLoginDelayMs());
                const expiresAt = resolveExpiresAtMs(data, token);
                await writeCachedToken(this.cacheKey, {
                    token,
                    expiresAt,
                    cachedAt: Date.now(),
                });
            }
            return token;
        })();

        if (this.cacheKey) {
            loginInFlight.set(this.cacheKey, loginPromise);
        }
        try {
            const token = await loginPromise;
            this.jwtToken = token;
            if (token) {
                this.authenticated = true;
            }
            return token;
        } catch (err) {
            this.authenticated = false;
            throw err;
        } finally {
            if (this.cacheKey) {
                loginInFlight.delete(this.cacheKey);
            }
        }
    }

    loadCachedTokenSync() {
        const cached = tokenCache.get(this.cacheKey);
        if (cached?.token) {
            this.jwtToken = cached.token;
            this.authenticated = true;
        }
    }

    async loadCachedToken() {
        const cached = await readCachedToken(this.cacheKey);
        if (cached?.token) {
            this.jwtToken = cached.token;
            this.authenticated = true;
        }
    }

    /**
     * Get all assets (devices) from Jumpserver
     */
    async getAssets({ limit = 100, offset = 0, search = '' } = {}) {
        const params = new URLSearchParams({ limit, offset });
        if (search) params.append('search', search);

        const response = await this.request(`/api/v1/assets/assets/?${params}`);
        return response.results || response;
    }

    /**
     * Get a specific asset by ID
     */
    async getAsset(assetId) {
        return await this.request(`/api/v1/assets/assets/${assetId}/`);
    }

    /**
     * Create a new asset
     */
    async createAsset(data, options = {}) {
        const assetType = options.assetType ? String(options.assetType).trim().toLowerCase() : null;
        const payloads = Array.isArray(options.payloads) && options.payloads.length
            ? options.payloads
            : [data];
        const endpoints = [];
        if (assetType) {
            endpoints.push(`/api/v1/assets/${assetType}/`);
        } else {
            endpoints.push('/api/v1/assets/hosts/', '/api/v1/assets/devices/', '/api/v1/assets/assets/');
        }
        let lastError = null;
        for (const endpoint of endpoints) {
            for (const payload of payloads) {
                try {
                    return await this.request(endpoint, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });
                } catch (err) {
                    lastError = err;
                    const message = String(err?.message || err);
                    if (message.includes('Cannot create asset directly')) {
                        break;
                    }
                    if (message.includes('404') || message.includes('Not Found') || message.includes('405')) {
                        break;
                    }
                    if (message.includes('Server internal error') || message.includes('500')) {
                        continue;
                    }
                    if (assetType) {
                        break;
                    }
                    // Try alternative asset types when available.
                }
                // Stop trying payload variants for this endpoint unless we hit a 500.
                if (lastError && !String(lastError?.message || lastError).includes('500')) {
                    break;
                }
            }
        }
        throw lastError || new Error('Jumpserver asset creation failed');
    }

    /**
     * Update an asset (partial)
     */
    async updateAsset(assetId, data) {
        return await this.request(`/api/v1/assets/assets/${assetId}/`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    /**
     * Get all system users
     */
    async getSystemUsers({ limit = 100, offset = 0 } = {}) {
        const params = new URLSearchParams({ limit, offset });
        const response = await this.request(`/api/v1/assets/system-users/?${params}`);
        return response.results || response;
    }

    /**
     * Request a connection token for a SSH session
     * This token is used to establish WebSocket connection to Koko
     */
    async requestConnectionToken({ userId, assetId, systemUserId }) {
        const payload = {
            user: userId,
            asset: assetId,
            system_user: systemUserId,
        };

        const response = await this.request('/api/v1/authentication/connection-token/', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        return {
            token: response.id || response.token,
            secret: response.secret,
            url: `${this.baseUrl}/koko/token/?target_id=${response.id}`,
        };
    }

    /**
     * List recorded sessions
     */
    async listSessions({ assetId, userId, limit = 50, offset = 0 } = {}) {
        const params = new URLSearchParams({ limit, offset });
        if (assetId) params.append('asset', assetId);
        if (userId) params.append('user', userId);

        const response = await this.request(`/api/v1/terminal/sessions/?${params}`);
        return response.results || response;
    }

    /**
     * Get session detail
     */
    async getSession(sessionId) {
        return await this.request(`/api/v1/terminal/sessions/${sessionId}/`);
    }

    /**
     * Get session replay data
     * Returns replay log that can be played with asciinema player
     */
    async getSessionReplay(sessionId) {
        const response = await this.request(`/api/v1/terminal/sessions/${sessionId}/replay/`);
        // Jumpserver returns asciicast format
        return response;
    }

    /**
     * Terminate an active session
     */
    async terminateSession(sessionId) {
        return await this.request(`/api/v1/terminal/sessions/${sessionId}/`, {
            method: 'DELETE',
        });
    }

    /**
     * Build WebSocket URL for Koko terminal connection
     */
    buildKokoWebSocketUrl(connectionToken) {
        const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
        const baseWsUrl = this.baseUrl.replace(/^https?/, wsProtocol);
        return `${baseWsUrl}/koko/ws/token/?target_id=${connectionToken}`;
    }
}

/**
 * Create Jumpserver client from application configuration
 */
export async function createJumpserverClientFromConfig(prisma, tenantId) {
    const baseFilter = { name: { contains: 'jumpserver', mode: 'insensitive' } };

    let config = null;
    if (tenantId) {
        config = await prisma.application.findFirst({
            where: { tenantId, ...baseFilter },
            orderBy: { updatedAt: 'desc' },
        });
    }

    if (!config) {
        config = await prisma.application.findFirst({
            where: { ...baseFilter },
            orderBy: { updatedAt: 'desc' },
        });
    }

    if (!config) {
        return null;
    }

    let organizationId = null;
    let username = null;
    let password = null;
    if (config.config) {
        try {
            const cfg = JSON.parse(config.config);
            organizationId = cfg.organizationId || null;
            username = cfg.username || null;
            password = cfg.password || null;
        } catch {
            organizationId = null;
        }
    }

    return new JumpserverClient({
        baseUrl: config.url,
        apiToken: config.apiKey,
        organizationId,
        username,
        password,
    });
}
