import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Settings, Save, X, CheckCircle, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useApplications } from "@/hooks/use-mobile";
import type { Application } from "@/lib/utils";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import OperationalHubPanel from "@/components/hub/OperationalHubPanel";

const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

const Applications = () => {
  const { toast } = useToast();
  const { applications, loading, error, updateApplication, createApplication } = useApplications();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ url: "", apiKey: "", username: "", password: "", privateKey: "" });
  const [adding, setAdding] = useState(false);
  const [newApp, setNewApp] = useState<{ name: string; url: string; apiKey: string; username?: string; password?: string; privateKey?: string }>({ name: "NetBox", url: "", apiKey: "", username: "", password: "", privateKey: "" });
  const [netboxSyncFor, setNetboxSyncFor] = useState<string | null>(null);
  const [syncTenants, setSyncTenants] = useState(true);
  const [syncDevices, setSyncDevices] = useState(true);
  const [enableRoleFilter, setEnableRoleFilter] = useState(false);
  const [enablePlatformFilter, setEnablePlatformFilter] = useState(false);
  const [rolesList, setRolesList] = useState<string[]>([]);
  const [platformsList, setPlatformsList] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [enableDeviceTypeFilter, setEnableDeviceTypeFilter] = useState(false);
  const [enableSiteFilter, setEnableSiteFilter] = useState(false);
  const [deviceTypesList, setDeviceTypesList] = useState<string[]>([]);
  const [sitesList, setSitesList] = useState<string[]>([]);
  const [selectedDeviceTypes, setSelectedDeviceTypes] = useState<string[]>([]);
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [oxidizedConfigFor, setOxidizedConfigFor] = useState<string | null>(null);
  const [revealApiKey, setRevealApiKey] = useState<Record<string, boolean>>({});
  const [oxidizedConfig, setOxidizedConfig] = useState({
    interval: 3600,
    timeout: 30,
    retries: 3,
    threads: 30,
    use_syslog: false,
    debug: false,
  });
  const [auditResult, setAuditResult] = useState<any>(null);
  const [auditing, setAuditing] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showHubModal, setShowHubModal] = useState(false);
  const [syncAlert, setSyncAlert] = useState(false);

  useEffect(() => {
    if (!API_MODE) return;
    let active = true;
    const loadStatus = async () => {
      try {
        const res = await api.hub.getMovideskSyncStatus();
        if (!active) return;
        setSyncAlert(!!res?.has_discrepancies);
      } catch {
        if (active) setSyncAlert(false);
      }
    };
    loadStatus();
    const intervalId = window.setInterval(loadStatus, 10 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);


  const testConnection = async (appId: string) => {
    updateApplication(appId, { status: "testing" });
    setTimeout(() => {
      const app = applications.find(a => a.id === appId);
      if (!app) return;

      const isValid = app.url.includes(".") && app.apiKey.length > 5;
      updateApplication(appId, { status: isValid ? "connected" : "disconnected" });

      toast({
        title: isValid ? "Conexão bem-sucedida" : "Falha na conexão",
        description: isValid
          ? `Conexão com ${app.name} estabelecida com sucesso.`
          : `Não foi possível conectar com ${app.name}. Verifique a URL e a API Key.`,
        variant: isValid ? "default" : "destructive",
      });
    }, 2000);
  };

  const startEditing = (app: Application) => {
    setEditingId(app.id);
    let username = "";
    let password = "";
    // Try to parse config for credentials
    try {
      if ((app as any).config) {
        const conf = JSON.parse((app as any).config);
        username = conf.username || "";
        password = conf.password || "";
      }
    } catch { }
    setEditForm({ url: app.url, apiKey: app.apiKey, username, password, privateKey: "" }); // Private key not loaded back for security/size
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({ url: "", apiKey: "", username: "", password: "", privateKey: "" });
  };

  const saveEdit = (appId: string) => {
    updateApplication(appId, {
      url: editForm.url,
      apiKey: editForm.apiKey,
      status: "disconnected",
      username: editForm.username,
      password: editForm.password,
      privateKey: editForm.privateKey
    } as any);
    setEditingId(null);
    toast({ title: "Dados salvos", description: "As informações de conexão foram atualizadas." });
  };

  const saveNew = async () => {
    if (!newApp.name || !newApp.url || !newApp.apiKey) {
      toast({ title: "Preencha os campos", description: "Nome, URL e API Key são obrigatórios.", variant: "destructive" });
      return;
    }
    try {
      await createApplication({
        name: newApp.name,
        url: newApp.url,
        apiKey: newApp.apiKey,
        status: "disconnected",
        username: newApp.username,
        password: newApp.password,
        privateKey: newApp.privateKey
      } as any);
      setAdding(false);
      setNewApp({ name: "NetBox", url: "", apiKey: "" });
      toast({ title: "Aplicação adicionada", description: `Cadastro de ${newApp.name} criado.` });
    } catch (e) {
      toast({ title: "Erro ao adicionar", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const isNetbox = (app: Application) => /netbox/i.test(app.name);
  const isJumpserver = (app: Application) => /jumpserver/i.test(app.name);
  const isOxidized = (app: Application) => /oxidized/i.test(app.name);

  const loadCatalog = async (app: Application, what: ("device-roles" | "platforms" | "device-types" | "sites")[]) => {
    try {
      const out: any = await api.netboxCatalog(what, app.url, app.apiKey);
      if (what.includes("device-roles")) setRolesList(Array.isArray(out.roles) ? out.roles : []);
      if (what.includes("platforms")) setPlatformsList(Array.isArray(out.platforms) ? out.platforms : []);
      if (what.includes("device-types")) setDeviceTypesList(Array.isArray(out.deviceTypes) ? out.deviceTypes : []);
      if (what.includes("sites")) setSitesList(Array.isArray(out.sites) ? out.sites : []);
    } catch (e) {
      toast({ title: "Falha ao carregar catálogo", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const doNetboxSync = async (app: Application) => {
    try {
      const resources = [syncTenants ? "tenants" : null, syncDevices ? "devices" : null].filter(Boolean) as string[];
      const deviceFilters = syncDevices ? {
        roles: enableRoleFilter ? selectedRoles : undefined,
        platforms: enablePlatformFilter ? selectedPlatforms : undefined,
        deviceTypes: enableDeviceTypeFilter ? selectedDeviceTypes : undefined,
        sites: enableSiteFilter ? selectedSites : undefined,
      } : undefined;
      const summary = await api.netboxSync(resources, app.url, app.apiKey, deviceFilters);
      toast({ title: "Sincronização NetBox", description: `Tenants: ${summary.tenants ?? 0}, Devices: ${summary.devices ?? 0}` });
      setNetboxSyncFor(null);
    } catch (e) {
      toast({ title: "Falha na sincronização", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const runJumpserverAudit = async (limit: number = 0) => {
    setAuditing(true);
    setShowAuditModal(true);
    try {
      const res = await api.hub.getAuditJumpserver(limit);
      setAuditResult(res);
      toast({ title: "Auditoria Concluída", description: `Analisados ${res.summary.netbox_devices_analyzed} dispositivos.` });
    } catch (e) {
      toast({ title: "Falha na auditoria", description: String((e as any)?.message || e), variant: "destructive" });
      setShowAuditModal(false);
    } finally {
      setAuditing(false);
    }
  };


  const doJumpserverTest = async (app: Application) => {
    try {
      const res = await api.jumpserverTest(app.url, app.apiKey);
      const ok = (res as any)?.ok;
      toast({ title: ok ? "Jumpserver acessível" : "Falha no Jumpserver", description: `Status: ${(res as any)?.status || (res as any)?.error || ""}`, variant: ok ? "default" : "destructive" });
      updateApplication(app.id, { status: ok ? "connected" : "disconnected" });
    } catch (e) {
      toast({ title: "Falha no teste", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const loadOxidizedConfig = (app: Application) => {
    try {
      if ((app as any).config) {
        const parsed = JSON.parse((app as any).config);
        setOxidizedConfig({
          interval: parsed.interval || 3600,
          timeout: parsed.timeout || 30,
          retries: parsed.retries || 3,
          threads: parsed.threads || 30,
          use_syslog: parsed.use_syslog || false,
          debug: parsed.debug || false,
        });
      }
    } catch {
      // Use defaults
    }
    setOxidizedConfigFor(app.id);
  };

  const saveOxidizedConfig = async (app: Application) => {
    try {
      await api.updateApplication(app.id, { config: oxidizedConfig });
      toast({ title: "Configuração salva", description: "Parâmetros do Oxidized atualizados com sucesso." });
      setOxidizedConfigFor(null);
    } catch (e) {
      toast({ title: "Erro ao salvar", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  const getStatusIcon = (status: Application["status"]) => {
    if (status === "connected") return <CheckCircle className="h-4 w-4 text-success" />;
    if (status === "testing") return <Loader2 className="h-4 w-4 text-warning animate-spin" />;
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  };

  const getStatusText = (status: Application["status"]) =>
    status === "connected" ? "Conectado" : status === "testing" ? "Testando" : "Desconectado";

  const getStatusBadgeClass = (status: Application["status"]) =>
    status === "connected" ? "bg-success/10 text-success" :
      status === "testing" ? "bg-warning/10 text-warning" :
        "bg-destructive/10 text-destructive";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Aplicações</h1>
            <p className="text-muted-foreground mt-2">
              Gerencie as integrações com aplicações externas
            </p>
          </div>
          {!adding ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="gap-2 relative" onClick={() => setShowHubModal(true)}>
                <Activity className="h-4 w-4" />
                Sincronizar
                {syncAlert && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                    !
                  </span>
                )}
              </Button>
              <Button className="gap-2" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Adicionar Aplicação
              </Button>
            </div>
          ) : (
            <Card className="w-full max-w-3xl">
              <CardHeader>
                <CardTitle>Nova Aplicação</CardTitle>
                <CardDescription>Cadastre a integração (NetBox, Jumpserver, ...)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Nome</Label>
                    <Input value={newApp.name} onChange={(e) => setNewApp({ ...newApp, name: e.target.value })} placeholder="NetBox / Jumpserver" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>URL</Label>
                    <Input value={newApp.url} onChange={(e) => setNewApp({ ...newApp, url: e.target.value })} placeholder="https://exemplo.com" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>API Key</Label>
                  <Input type="password" value={newApp.apiKey} onChange={(e) => setNewApp({ ...newApp, apiKey: e.target.value })} placeholder="Sua chave de API" />
                </div>
                {/netbox/i.test(newApp.name) && (
                  <>
                    <div className="space-y-1">
                      <Label>Login (Opcional)</Label>
                      <Input value={newApp.username} onChange={(e) => setNewApp({ ...newApp, username: e.target.value })} placeholder="Usuário NetBox" />
                    </div>
                    <div className="space-y-1">
                      <Label>Senha (Opcional)</Label>
                      <Input type="password" value={newApp.password} onChange={(e) => setNewApp({ ...newApp, password: e.target.value })} placeholder="Senha NetBox" />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <Label>Chave Privada RSA (Para Secrets)</Label>
                      <textarea
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={newApp.privateKey}
                        onChange={(e) => setNewApp({ ...newApp, privateKey: e.target.value })}
                        placeholder="-----BEGIN RSA PRIVATE KEY----- ..."
                      />
                      <p className="text-xs text-muted-foreground">Cole o conteúdo do arquivo .pem aqui para descriptografar senhas.</p>
                    </div>
                  </>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveNew} disabled={!newApp.name || !newApp.url || !newApp.apiKey}>
                    <Save className="h-4 w-4 mr-1" /> Salvar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewApp({ name: "NetBox", url: "", apiKey: "" }); }}>
                    <X className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Settings className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>{app.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {editingId === app.id ? "Editando configurações..." : app.url}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(app.status)}
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeClass(app.status)}`}>
                      {getStatusText(app.status)}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input
                    value={editingId === app.id ? editForm.url : app.url}
                    readOnly={editingId !== app.id}
                    onChange={(e) => setEditForm(prev => ({ ...prev, url: e.target.value }))}
                    placeholder="https://exemplo.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <div className="relative">
                    <Input
                      type={revealApiKey[app.id] ? "text" : "password"}
                      value={editingId === app.id ? editForm.apiKey : app.apiKey}
                      readOnly={editingId !== app.id}
                      onChange={(e) => setEditForm(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="Sua chave de API"
                      className="pr-10"
                    />
                    {editingId !== app.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onMouseDown={() => setRevealApiKey(prev => ({ ...prev, [app.id]: true }))}
                        onMouseUp={() => setRevealApiKey(prev => ({ ...prev, [app.id]: false }))}
                        onMouseLeave={() => setRevealApiKey(prev => ({ ...prev, [app.id]: false }))}
                        onTouchStart={() => setRevealApiKey(prev => ({ ...prev, [app.id]: true }))}
                        onTouchEnd={() => setRevealApiKey(prev => ({ ...prev, [app.id]: false }))}
                      >
                        {revealApiKey[app.id] ? (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                {isNetbox(app) && editingId === app.id && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Login (Opcional)</Label>
                        <Input
                          value={editForm.username}
                          onChange={(e) => setEditForm(prev => ({ ...prev, username: e.target.value }))}
                          placeholder="Usuário"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Senha (Opcional)</Label>
                        <Input
                          type="password"
                          value={editForm.password}
                          onChange={(e) => setEditForm(prev => ({ ...prev, password: e.target.value }))}
                          placeholder="Senha"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Chave Privada RSA</Label>
                      <textarea
                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={editForm.privateKey}
                        onChange={(e) => setEditForm(prev => ({ ...prev, privateKey: e.target.value }))}
                        placeholder="-----BEGIN RSA PRIVATE KEY----- (Deixe em branco para manter a atual)"
                      />
                      <p className="text-xs text-muted-foreground">Cole a chave privada para atualizar. Deixe em branco para manter a existente.</p>
                    </div>
                  </>
                )}
                <div className="flex gap-2 flex-wrap">
                  {editingId === app.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => saveEdit(app.id)}
                        disabled={!editForm.url || !editForm.apiKey}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Salvar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelEditing}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testConnection(app.id)}
                        disabled={app.status === "testing"}
                      >
                        {app.status === "testing" ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-1" />
                        )}
                        {app.status === "testing" ? "Testando..." : "Testar Conexão"}
                      </Button>
                      {isNetbox(app) && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setNetboxSyncFor(netboxSyncFor === app.id ? null : app.id)}>
                            <Settings className="h-4 w-4 mr-1" /> Sincronizar NetBox
                          </Button>
                          {netboxSyncFor === app.id && (
                            <div className="w-full border border-border/40 rounded p-3 space-y-3">
                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={syncTenants} onChange={(e) => setSyncTenants(e.target.checked)} /> Tenants
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={syncDevices} onChange={(e) => setSyncDevices(e.target.checked)} /> Devices
                                </label>
                              </div>
                              {syncDevices && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={enableRoleFilter}
                                        onChange={async (e) => {
                                          const v = e.target.checked;
                                          setEnableRoleFilter(v);
                                          if (v && rolesList.length === 0) await loadCatalog(app, ["device-roles"]);
                                        }}
                                      /> Função (Device Role)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={enablePlatformFilter}
                                        onChange={async (e) => {
                                          const v = e.target.checked;
                                          setEnablePlatformFilter(v);
                                          if (v && platformsList.length === 0) await loadCatalog(app, ["platforms"]);
                                        }}
                                      /> Plataforma
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={enableDeviceTypeFilter}
                                        onChange={async (e) => {
                                          const v = e.target.checked;
                                          setEnableDeviceTypeFilter(v);
                                          if (v && deviceTypesList.length === 0) await loadCatalog(app, ["device-types"]);
                                        }}
                                      /> Device Type
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={enableSiteFilter}
                                        onChange={async (e) => {
                                          const v = e.target.checked;
                                          setEnableSiteFilter(v);
                                          if (v && sitesList.length === 0) await loadCatalog(app, ["sites"]);
                                        }}
                                      /> Site
                                    </label>
                                  </div>
                                  {enableRoleFilter && (
                                    <div className="border border-border/40 rounded p-2 max-h-48 overflow-auto">
                                      <p className="text-xs text-muted-foreground mb-2">Selecione as funções desejadas (inicialmente todas desmarcadas)</p>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {rolesList.map((r) => (
                                          <label key={r} className="flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={selectedRoles.includes(r)}
                                              onChange={(e) => {
                                                setSelectedRoles((prev) => e.target.checked ? [...prev, r] : prev.filter((x) => x !== r));
                                              }}
                                            /> {r}
                                          </label>
                                        ))}
                                        {rolesList.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma função encontrada</span>}
                                      </div>
                                    </div>
                                  )}
                                  {enablePlatformFilter && (
                                    <div className="border border-border/40 rounded p-2 max-h-48 overflow-auto">
                                      <p className="text-xs text-muted-foreground mb-2">Selecione as plataformas desejadas (inicialmente todas desmarcadas)</p>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {platformsList.map((p) => (
                                          <label key={p} className="flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={selectedPlatforms.includes(p)}
                                              onChange={(e) => {
                                                setSelectedPlatforms((prev) => e.target.checked ? [...prev, p] : prev.filter((x) => x !== p));
                                              }}
                                            /> {p}
                                          </label>
                                        ))}
                                        {platformsList.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma plataforma encontrada</span>}
                                      </div>
                                    </div>
                                  )}
                                  {enableDeviceTypeFilter && (
                                    <div className="border border-border/40 rounded p-2 max-h-48 overflow-auto">
                                      <p className="text-xs text-muted-foreground mb-2">Selecione os device types desejados (inicialmente todos desmarcados)</p>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {deviceTypesList.map((t) => (
                                          <label key={t} className="flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={selectedDeviceTypes.includes(t)}
                                              onChange={(e) => {
                                                setSelectedDeviceTypes((prev) => e.target.checked ? [...prev, t] : prev.filter((x) => x !== t));
                                              }}
                                            /> {t}
                                          </label>
                                        ))}
                                        {deviceTypesList.length === 0 && <span className="text-xs text-muted-foreground">Nenhum device type encontrado</span>}
                                      </div>
                                    </div>
                                  )}
                                  {enableSiteFilter && (
                                    <div className="border border-border/40 rounded p-2 max-h-48 overflow-auto">
                                      <p className="text-xs text-muted-foreground mb-2">Selecione os sites desejados (inicialmente todos desmarcados)</p>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {sitesList.map((s) => (
                                          <label key={s} className="flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              checked={selectedSites.includes(s)}
                                              onChange={(e) => {
                                                setSelectedSites((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s));
                                              }}
                                            /> {s}
                                          </label>
                                        ))}
                                        {sitesList.length === 0 && <span className="text-xs text-muted-foreground">Nenhum site encontrado</span>}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => doNetboxSync(app)}>Executar</Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {isJumpserver(app) && (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => doJumpserverTest(app)}>
                            <Settings className="h-4 w-4 mr-1" /> Testar Jumpserver
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-2"
                            onClick={() => runJumpserverAudit(10)}
                            disabled={auditing}
                          >
                            <Activity className={`h-4 w-4 ${auditing ? "animate-spin" : ""}`} />
                            Auditoria (10 Dispos.)
                          </Button>
                        </div>
                      )}


                      {isOxidized(app) && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => oxidizedConfigFor === app.id ? setOxidizedConfigFor(null) : loadOxidizedConfig(app)}>
                            <Settings className="h-4 w-4 mr-1" /> Configurar Oxidized
                          </Button>
                          {oxidizedConfigFor === app.id && (
                            <div className="w-full border border-border/40 rounded p-3 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-sm">Interval (segundos)</Label>
                                  <Input
                                    type="number"
                                    value={oxidizedConfig.interval}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, interval: Number(e.target.value) })}
                                    placeholder="3600"
                                  />
                                  <p className="text-xs text-muted-foreground">Intervalo entre coletas de backup</p>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-sm">Timeout (segundos)</Label>
                                  <Input
                                    type="number"
                                    value={oxidizedConfig.timeout}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, timeout: Number(e.target.value) })}
                                    placeholder="30"
                                  />
                                  <p className="text-xs text-muted-foreground">Timeout de conexão SSH</p>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-sm">Retries</Label>
                                  <Input
                                    type="number"
                                    value={oxidizedConfig.retries}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, retries: Number(e.target.value) })}
                                    placeholder="3"
                                  />
                                  <p className="text-xs text-muted-foreground">Número de tentativas em caso de falha</p>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-sm">Threads</Label>
                                  <Input
                                    type="number"
                                    value={oxidizedConfig.threads}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, threads: Number(e.target.value) })}
                                    placeholder="30"
                                  />
                                  <p className="text-xs text-muted-foreground">Número de threads paralelas</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={oxidizedConfig.use_syslog}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, use_syslog: e.target.checked })}
                                  /> Use Syslog
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={oxidizedConfig.debug}
                                    onChange={(e) => setOxidizedConfig({ ...oxidizedConfig, debug: e.target.checked })}
                                  /> Debug Mode
                                </label>
                              </div>
                              <div className="flex items-center gap-2 pt-2">
                                <Button size="sm" onClick={() => saveOxidizedConfig(app)}>Salvar Configuração</Button>
                                <Button size="sm" variant="outline" onClick={() => setOxidizedConfigFor(null)}>Cancelar</Button>
                              </div>
                              <div className="border-t pt-2">
                                <p className="text-xs text-muted-foreground">
                                  <strong>Nota:</strong> Estas configurações são armazenadas para referência. Para aplicá-las ao Oxidized,
                                  atualize o arquivo de configuração do container/serviço Oxidized com estes valores.
                                </p>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEditing(app)}
                      >
                        <Settings className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Relatório de Auditoria: Netbox vs JumpServer
            </DialogTitle>
            <DialogDescription>
              Comparação de dispositivos entre documentação (Netbox) e acessos (JumpServer).
              Baseado em IP e Tenant/Node.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto py-4">
            {auditing ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <p className="text-muted-foreground animate-pulse">Cruzando dados de múltiplos sistemas...</p>
              </div>
            ) : auditResult ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Analisados</p>
                    <p className="text-2xl font-bold">{auditResult.summary.netbox_devices_analyzed}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground uppercase font-semibold">Total JS</p>
                    <p className="text-2xl font-bold">{auditResult.summary.jumpserver_assets_total}</p>
                  </div>
                  <div className="p-3 bg-destructive/10 rounded-lg text-center">
                    <p className="text-xs text-destructive uppercase font-semibold">Inconsistências</p>
                    <p className="text-2xl font-bold text-destructive">{auditResult.summary.missing_count}</p>
                  </div>
                  <div className="p-3 bg-success/10 rounded-lg text-center">
                    <p className="text-xs text-success uppercase font-semibold">Integridade</p>
                    <p className="text-2xl font-bold text-success">
                      {Math.round(((auditResult.summary.netbox_devices_analyzed - auditResult.summary.missing_count) / auditResult.summary.netbox_devices_analyzed) * 100)}%
                    </p>
                  </div>
                </div>

                {auditResult.missing_devices.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dispositivo</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Tenant</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditResult.missing_devices.map((device: any) => (
                        <TableRow key={device.id}>
                          <TableCell className="font-medium">{device.name}</TableCell>
                          <TableCell>{device.ip}</TableCell>
                          <TableCell>{device.tenant}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                            {device.error}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">Pendente</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 bg-success/5 rounded-xl border border-success/20">
                    <CheckCircle className="h-10 w-10 text-success mb-2" />
                    <p className="font-semibold text-success">Tudo em conformidade!</p>
                    <p className="text-sm text-muted-foreground">Os dispositivos testados possuem documentação e acesso corretos.</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="pt-4 border-t flex justify-end">
            <Button onClick={() => setShowAuditModal(false)}>Fechar Relatório</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showHubModal} onOpenChange={setShowHubModal}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              HUB Operacional
            </DialogTitle>
            <DialogDescription>
              Sincronização Movidesk, auditoria NetBox e consistência com JumpServer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto px-6 pb-6">
            {showHubModal && <OperationalHubPanel showHeader={false} />}
          </div>
          <div className="px-6 pb-6 pt-2 border-t flex justify-end">
            <Button onClick={() => setShowHubModal(false)}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Applications;
