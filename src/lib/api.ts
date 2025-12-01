const API_BASE = import.meta.env.VITE_API_URL || "/api";

export function getToken() {
  return localStorage.getItem("auth_token") || "";
}

function setToken(token: string) {
  localStorage.setItem("auth_token", token);
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    // Redireciona apenas para 401 (token inválido/ausente). Mantém 403 (sem permissão) conectado.
    if (res.status === 401 && getToken() && !String(path).startsWith('/auth/')) {
      try { localStorage.removeItem("auth_token"); } catch { }
      try { sonnerToast("Sessão expirada. Faça login novamente."); } catch { }
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
    }
    if (res.status === 403 && !String(path).startsWith('/auth/')) {
      try { sonnerToast("Acesso negado. Você não tem permissão para esta ação."); } catch { }
    }
    let message = `HTTP ${res.status}`;
    try {
      if (contentType.includes("application/json")) {
        const data = await res.json();
        message = data?.error || data?.message || message;
      } else {
        const text = await res.text();
        message = text || message;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const api = {
  setToken,
  async register(email: string, password: string, options?: { username?: string; tenantName?: string }) {
    const payload: Record<string, any> = { email, password };
    if (options?.username) payload.username = options.username;
    if (options?.tenantName) payload.tenantName = options.tenantName;
    const json = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setToken((json as any).token);
    return json;
  },
  async login(identifier: string, password: string) {
    const json = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
    setToken((json as any).token);
    return json;
  },
  async changePassword(identifier: string, currentPassword: string, newPassword: string) {
    const json = await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ identifier, currentPassword, newPassword })
    });
    if ((json as any)?.token) setToken((json as any).token);
    return json;
  },
  async listDevices(tenantId?: string | number) {
    const qs = tenantId ? `?tenantId=${tenantId}` : "";
    const list = await apiFetch(`/devices${qs}`, { method: "GET" });
    return (list as any[]).map((d) => ({ ...d, id: String(d.id), tenantId: String(d.tenantId) }));
  },
  async createDevice(data: any) {
    const created = await apiFetch("/devices", { method: "POST", body: JSON.stringify(data) });
    const c = created as any;
    return { ...c, id: String(c.id), tenantId: String(c.tenantId) };
  },
  async updateDevice(id: string | number, patch: any) {
    const updated = await apiFetch(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const u = updated as any;
    return { ...u, id: String(u.id), tenantId: String(u.tenantId) };
  },
  async getDeviceCredentials(id: string | number, reveal?: boolean) {
    const qs = reveal ? '?reveal=1' : '';
    return apiFetch(`/devices/${id}/credentials${qs}`, { method: 'GET' });
  },
  async updateDeviceCredentials(id: string | number, payload: { username?: string; password?: string | null }) {
    return apiFetch(`/devices/${id}/credentials`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async updateDeviceLocalAsn(id: string | number, localAsn: number) {
    return apiFetch(`/devices/${id}/local-asn`, { method: 'PATCH', body: JSON.stringify({ localAsn }) });
  },
  async deleteDevice(id: string | number) {
    await apiFetch(`/devices/${id}`, { method: "DELETE" });
    return true;
  },
  async listApplications() {
    const list = await apiFetch("/applications", { method: "GET" });
    return (list as any[]).map((a) => ({ ...a, id: String(a.id), tenantId: String(a.tenantId) }));
  },
  async createApplication(data: { name: string; url: string; apiKey: string; status?: string; description?: string }) {
    const created = await apiFetch("/applications", { method: "POST", body: JSON.stringify(data) });
    const a = created as any;
    return { ...a, id: String(a.id), tenantId: String(a.tenantId) };
  },
  async updateApplication(id: string | number, patch: any) {
    const updated = await apiFetch(`/applications/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const u = updated as any;
    return { ...u, id: String(u.id), tenantId: String(u.tenantId) };
  },
  // Descoberta SNMP - persistência
  async saveDiscoveredInterfaces(deviceId: string | number, interfaces: Array<{ index: string | number; name: string; desc?: string; type?: number }>) {
    return apiFetch(`/devices/${deviceId}/discovery/interfaces`, {
      method: "POST",
      body: JSON.stringify({ interfaces }),
    });
  },
  async getDiscoveredInterfaces(deviceId: string | number) {
    return apiFetch(`/devices/${deviceId}/discovery/interfaces`, { method: "GET" });
  },
  async saveDiscoveredPeers(deviceId: string | number, peers: Array<{ ip: string; asn: number; name?: string; vrf_name?: string }>, localAsn?: number) {
    return apiFetch(`/devices/${deviceId}/discovery/peers`, {
      method: "POST",
      body: JSON.stringify({ peers, localAsn }),
    });
  },
  async getDiscoveredPeers(deviceId: string | number) {
    return apiFetch(`/devices/${deviceId}/discovery/peers`, { method: "GET" });
  },
  async listBgpPeers(tenantId?: string | number) {
    const qs = tenantId ? `?tenantId=${tenantId}` : '';
    return apiFetch(`/bgp/peers${qs}`, { method: 'GET' });
  },
  // Integrações
  async netboxSync(resources: string[], url?: string, token?: string, deviceFilters?: { roles?: string[]; platforms?: string[]; deviceTypes?: string[]; sites?: string[] }) {
    return apiFetch(`/netbox/sync`, { method: "POST", body: JSON.stringify({ resources, url, token, deviceFilters }) });
  },
  async netboxCatalog(resources: string[], url?: string, token?: string) {
    return apiFetch(`/netbox/catalog`, { method: "POST", body: JSON.stringify({ resources, url, token }) });
  },
  async startDiscoveryJob(deviceId: string | number, type: 'interfaces' | 'peers') {
    return apiFetch(`/devices/${deviceId}/discovery/jobs`, { method: 'POST', body: JSON.stringify({ type }) });
  },
  async getJobStatus(queue: string, jobId: string) {
    return apiFetch(`/queues/${queue}/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
  },
  async listQueueJobs(queue: string, status: string = 'active', start = 0, end = 20) {
    const params = new URLSearchParams({ status, start: String(start), end: String(end) });
    return apiFetch(`/queues/${queue}/jobs?${params.toString()}`, { method: 'GET' });
  },
  async jumpserverTest(url?: string, apiKey?: string) {
    return apiFetch(`/jumpserver/test`, { method: "POST", body: JSON.stringify({ url, apiKey }) });
  },
  async jumpserverConnect(deviceId: string | number) {
    return apiFetch(`/jumpserver/connect/${deviceId}`, { method: "POST" });
  },
  async getStatsOverview(tenantId?: string | number) {
    const qs = tenantId ? `?tenantId=${tenantId}` : "";
    return apiFetch(`/stats/overview${qs}`, { method: "GET" });
  },
  async adminSummary() {
    return apiFetch(`/admin/summary`, { method: "GET" });
  },
  async adminPurge(options: { devices?: boolean; discoveries?: boolean; applications?: boolean; tenants?: boolean; confirm: string; dryRun?: boolean; global?: boolean }) {
    return apiFetch(`/admin/purge`, { method: "POST", body: JSON.stringify(options) });
  },
  async adminSnapshot() {
    return apiFetch(`/admin/snapshot`, { method: "GET" });
  },
  async adminImportSnapshot(data: any, options: { importTenants?: boolean; importDevices?: boolean; importApplications?: boolean; importDiscoveries?: boolean; overwriteTenants?: boolean; overwriteDevices?: boolean; overwriteApplications?: boolean; overwriteDiscoveries?: boolean }) {
    return apiFetch(`/admin/import-snapshot`, { method: "POST", body: JSON.stringify({ data, options }) });
  },
  async adminAuditList(params?: { action?: string; from?: string; to?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.set('action', params.action);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiFetch(`/admin/audit${qs ? `?${qs}` : ''}`, { method: "GET" });
  },
  async listTenants() {
    return apiFetch(`/tenants`, { method: "GET" });
  },
  async adminListUsers() {
    return apiFetch(`/admin/users`, { method: "GET" });
  },
  async adminCreateUser(data: { email: string; username?: string; password: string; role?: string; isActive?: boolean; tenantId?: number; tenantName?: string }) {
    return apiFetch(`/admin/users`, { method: "POST", body: JSON.stringify(data) });
  },
  async adminUpdateUser(id: number, patch: { role?: string; isActive?: boolean; password?: string; tenantId?: number }) {
    return apiFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async adminDeleteUser(id: number) {
    return apiFetch(`/admin/users/${id}`, { method: "DELETE" });
  },
  async listAsnRegistry() {
    return apiFetch(`/asn-registry`, { method: 'GET' });
  },
  async upsertAsnRegistry(asn: number | string, name: string) {
    return apiFetch(`/asn-registry`, { method: 'POST', body: JSON.stringify({ asn: Number(asn), name }) });
  },
  async reprocessAsnRegistry() {
    return apiFetch(`/asn-registry/reprocess`, { method: 'POST' });
  },
  async getMe() {
    return apiFetch(`/me`, { method: 'GET' });
  },
  async updateMe(patch: { username?: string }) {
    return apiFetch(`/me`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async getDefaultAdminHint() {
    return apiFetch(`/auth/default-admin-hint`, { method: 'GET' });
  },
  async listBackupDevices(tenantId?: string | number) {
    const qs = tenantId ? `?tenantId=${tenantId}` : '';
    return apiFetch(`/backup/devices${qs}`, { method: 'GET' });
  },
  async updateBackupDevice(id: number | string, payload: { enabled?: boolean; sshPort?: number | null }) {
    return apiFetch(`/backup/devices/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  async getBackupVersions(id: number | string) {
    return apiFetch(`/backup/devices/${id}/versions`, { method: 'GET' });
  },
  async getBackupDiff(node: string, oid1: string, oid2: string) {
    const params = new URLSearchParams({ node, oid1, oid2 });
    return apiFetch(`/backup/diff?${params.toString()}`, { method: 'GET' });
  },
  async getBackupContent(node: string, oid: string) {
    const params = new URLSearchParams({ node, oid });
    return apiFetch(`/backup/content?${params.toString()}`, { method: 'GET' });
  },
  async getLogs(lines?: number, filter?: string) {
    const params = new URLSearchParams();
    if (lines) params.set('lines', String(lines));
    if (filter) params.set('filter', filter);
    const qs = params.toString();
    return apiFetch(`/admin/logs${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },
  async getHostStats() {
    return apiFetch(`/stats/host`, { method: 'GET' });
  },
  async createAccessSession(deviceId: number | string) {
    return apiFetch(`/access/sessions`, { method: 'POST', body: JSON.stringify({ deviceId: Number(deviceId) }) });
  },
  async listAccessSessions(limit = 50) {
    const params = new URLSearchParams({ limit: String(limit) });
    return apiFetch(`/access/sessions?${params.toString()}`, { method: 'GET' });
  },
  async getAccessSessionLog(id: number | string) {
    return apiFetch(`/access/sessions/${id}/log`, { method: 'GET' });
  },
  async getServiceHealth() {
    return apiFetch('/health/services', { method: 'GET' });
  },
  // Oxidized Proxy
  async listOxidizedProxies() {
    return apiFetch('/oxidized-proxy', { method: 'GET' });
  },
  async createOxidizedProxy(data: { name: string; siteId: string; gitRepoUrl?: string }) {
    return apiFetch('/oxidized-proxy', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateOxidizedProxy(id: number | string, data: { interval?: number }) {
    return apiFetch(`/oxidized-proxy/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  async deleteOxidizedProxy(id: number | string) {
    return apiFetch(`/oxidized-proxy/${id}`, { method: 'DELETE' });
  },
  async getOxidizedProxyDeployScript(id: number | string) {
    const res = await fetch(`${API_BASE}/oxidized-proxy/${id}/deploy-script`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  async syncOxidizedProxy(id: number | string) {
    return apiFetch(`/oxidized-proxy/${id}/sync`, { method: 'POST' });
  },
  async syncAllOxidizedProxies() {
    return apiFetch('/oxidized-proxy/sync-all', { method: 'POST' });
  },
  async getDeviceBackupLogs(deviceId: number | string, limit = 100) {
    return apiFetch(`/devices/${deviceId}/backup-logs?limit=${limit}`, { method: 'GET' });
  },
};
import { toast as sonnerToast } from "sonner";
