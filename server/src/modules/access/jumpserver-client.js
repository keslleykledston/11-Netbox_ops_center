// Jumpserver Client - API Integration
// Handles communication with Jumpserver REST API and WebSocket (Koko protocol)

import nodeFetch from 'node-fetch';

/**
 * Jumpserver API Client
 * Documentation: https://docs.jumpserver.org/zh/v3/dev/rest_api/
 */
export class JumpserverClient {
    constructor({ baseUrl, apiToken, organizationId = null }) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiToken = apiToken;
        this.organizationId = organizationId;
        this.authenticated = false;
    }

    /**
     * Make authenticated HTTP request to Jumpserver API
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        };

        if (this.organizationId) {
            headers['X-JMS-ORG'] = this.organizationId;
        }

        try {
            const response = await nodeFetch(url, {
                ...options,
                headers,
            });

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
    async createAsset(data) {
        return await this.request('/api/v1/assets/assets/', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    /**
     * Update an existing asset
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
    const config = await prisma.application.findFirst({
        where: {
            tenantId,
            name: 'Jumpserver',
        },
    });

    if (!config) {
        return null;
    }

    if (config.status !== 'connected') {
        return null;
    }

    const client = new JumpserverClient({
        baseUrl: config.url,
        apiToken: config.apiKey,
        organizationId: config.config ? JSON.parse(config.config).organizationId : null,
    });

    return client;
}
