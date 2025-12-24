import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { AlertCircle, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, UserCheck } from "lucide-react";

type OperationalHubPanelProps = {
  showHeader?: boolean;
};

const OperationalHubPanel = ({ showHeader = true }: OperationalHubPanelProps) => {
  const [auditData, setAuditData] = useState<any>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [syncReport, setSyncReport] = useState<any>(null);
  const [loadingSync, setLoadingSync] = useState(false);
  const [executingSync, setExecutingSync] = useState(false);
  const [showAllSync, setShowAllSync] = useState(false);
  const [selectedSync, setSelectedSync] = useState<string[]>([]);
  const [syncingDevices, setSyncingDevices] = useState<Record<string, boolean>>({});
  const [importedDevices, setImportedDevices] = useState<Record<string, boolean>>({});
  const [syncPendencies, setSyncPendencies] = useState<any[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string[]>([]);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ total: 0, completed: 0 });
  const [showTenantDropdown, setShowTenantDropdown] = useState(false);
  const tenantDropdownRef = useRef<HTMLDivElement | null>(null);

  const missingDevices = Array.isArray(auditData?.missing_devices) ? auditData.missing_devices : [];
  const tenantOptions = Array.from(new Set(missingDevices.map((d: any) => d?.tenant).filter(Boolean))).sort();
  const tenantTargetCount = tenantFilter.length > 0
    ? missingDevices.filter((d: any) => tenantFilter.includes(d?.tenant)).length
    : 0;

  const normalizeText = (value: any) => String(value || "").toLowerCase();
  const filteredDevices = missingDevices.filter((device: any) => {
    const matchesTenant = tenantFilter.length === 0 || tenantFilter.includes(device?.tenant);
    const search = normalizeText(deviceSearch);
    const matchesSearch = !search
      || normalizeText(device?.name).includes(search)
      || normalizeText(device?.ip).includes(search);
    return matchesTenant && matchesSearch;
  });

  const selectedFilteredCount = filteredDevices.filter((d: any) => selectedDevices.includes(String(d.id))).length;

  const allFilteredSelected = filteredDevices.length > 0 && filteredDevices.every((d: any) => selectedDevices.includes(String(d.id)));

  const toggleDeviceSelection = (deviceId: any) => {
    const key = String(deviceId);
    setSelectedDevices((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    if (!checked) {
      const filteredIds = new Set(filteredDevices.map((d: any) => String(d.id)));
      setSelectedDevices((prev) => prev.filter((id) => !filteredIds.has(id)));
      return;
    }
    const filteredIds = filteredDevices.map((d: any) => String(d.id));
    setSelectedDevices((prev) => Array.from(new Set([...prev, ...filteredIds])));
  };

  const toggleTenantFilter = (tenantName: string) => {
    setTenantFilter((prev) => (prev.includes(tenantName) ? prev.filter((t) => t !== tenantName) : [...prev, tenantName]));
  };

  const selectAllTenants = () => {
    setTenantFilter(tenantOptions);
  };

  const clearTenantFilter = () => {
    setTenantFilter([]);
  };

  const recordPendency = (device: any, reason: string) => {
    const key = String(device?.id || device?.name || "unknown");
    const entry = {
      key,
      name: device?.name || "N/A",
      ip: device?.ip || device?.ipAddress || "N/A",
      site: device?.site || "N/A",
      tenant: device?.tenant || "N/A",
      reason,
      updatedAt: new Date().toISOString(),
    };
    setSyncPendencies((prev) => {
      const idx = prev.findIndex((item) => item.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [entry, ...prev];
    });
  };

  const clearPendency = (device: any) => {
    const key = String(device?.id || device?.name || "unknown");
    setSyncPendencies((prev) => prev.filter((item) => item.key !== key));
  };

  const removeDeviceFromAudit = (deviceId: any) => {
    const key = String(deviceId);
    setAuditData((prev: any) => {
      if (!prev?.missing_devices) return prev;
      const nextMissing = prev.missing_devices.filter((d: any) => String(d.id) !== key);
      if (nextMissing.length === prev.missing_devices.length) return prev;
      const summary = prev.summary
        ? { ...prev.summary, missing_count: nextMissing.length }
        : prev.summary;
      return { ...prev, missing_devices: nextMissing, summary };
    });
    setSelectedDevices((prev) => prev.filter((id) => id !== key));
  };

  const clearAllPendencies = () => setSyncPendencies([]);

  const fetchAudit = async () => {
    setLoadingAudit(true);
    try {
      const data = await api.hub.getAuditJumpserver();
      setAuditData(data);
    } catch (error: any) {
      toast.error("Falha ao carregar auditoria: " + error.message);
    } finally {
      setLoadingAudit(false);
    }
  };

  const fetchSyncReport = async () => {
    setLoadingSync(true);
    try {
      const data = await api.hub.getMovideskSyncReport();
      setSyncReport(data);
      setSelectedSync([]);
    } catch (error: any) {
      toast.error("Falha ao carregar relatório Movidesk: " + error.message);
    } finally {
      setLoadingSync(false);
    }
  };

  const handleApproveSync = async () => {
    if (selectedSync.length === 0) return;
    setExecutingSync(true);
    try {
      const res = await api.hub.approveMovideskSync(selectedSync);
      const results = res.results || [];
      const success = results.filter((r: any) => r.status === "success").length;
      const warning = results.filter((r: any) => r.status === "warning").length;
      const error = results.filter((r: any) => r.status === "error").length;

      if (warning > 0 || error > 0) {
        toast.info(`Processamento concluído: ${success} OK, ${warning} Conflitos, ${error} Erros.`);
      } else {
        toast.success(`${success} ações executadas com sucesso.`);
      }
      fetchSyncReport();
    } catch (error: any) {
      toast.error("Erro ao processar aprovação: " + error.message);
    } finally {
      setExecutingSync(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedSync((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const syncDeviceInternal = async (device: any) => {
    if (!device?.id) return { ok: false };
    setSyncingDevices((prev) => ({ ...prev, [device.id]: true }));
    try {
      const res = await api.syncJumpserverDevice({
        netboxId: device.id,
        tenantName: device.tenant,
        deviceName: device.name,
        ipAddress: device.ip,
        confirm: true,
      });
      if (res?.netbox?.ok === false && res?.netbox?.error) {
        recordPendency(device, `NetBox: ${res?.netbox?.error || "erro desconhecido"}`);
        toast.warning(`Jumpserver OK, NetBox falhou: ${res?.netbox?.error || "erro desconhecido"}`);
      } else {
        clearPendency(device);
        toast.success(`Dispositivo ${device.name} sincronizado no Jumpserver.`);
      }
      if (res?.ok) {
        removeDeviceFromAudit(device.id);
      }
      if (res?.importedFromNetbox) {
        setImportedDevices((prev) => ({ ...prev, [device.id]: true }));
      }
      return { ok: true, res };
    } catch (error: any) {
      recordPendency(device, error.message || "Falha desconhecida");
      toast.error("Falha ao sincronizar: " + error.message);
      return { ok: false, error };
    } finally {
      setSyncingDevices((prev) => ({ ...prev, [device.id]: false }));
    }
  };

  const handleSyncDevice = async (device: any) => {
    if (!device?.id) return;
    const confirmed = window.confirm(`Sincronizar o dispositivo '${device.name}' no Jumpserver e NetBox?`);
    if (!confirmed) return;
    await syncDeviceInternal(device);
  };

  const handleBulkSync = async () => {
    if (selectedFilteredCount === 0 || batchSyncing) return;
    const targets = filteredDevices.filter((d: any) => selectedDevices.includes(String(d.id)));
    if (targets.length === 0) return;
    const confirmed = window.confirm(`Sincronizar ${targets.length} dispositivo(s) selecionado(s)?`);
    if (!confirmed) return;
    setBatchSyncing(true);
    setBatchProgress({ total: targets.length, completed: 0 });
    for (const device of targets) {
      await syncDeviceInternal(device);
      setBatchProgress((prev) => ({ total: prev.total, completed: prev.completed + 1 }));
    }
    setBatchSyncing(false);
    setBatchProgress({ total: 0, completed: 0 });
  };

  const handleTenantBulkSync = async () => {
    if (batchSyncing) return;
    const tenants = tenantFilter.length > 0 ? tenantFilter : [];
    if (tenants.length === 0) {
      toast.info("Selecione ao menos um cliente para sincronizar.");
      return;
    }
    const targets = missingDevices.filter((device: any) => tenants.includes(device?.tenant));
    if (targets.length === 0) {
      toast.info("Nenhum dispositivo pendente para os clientes selecionados.");
      return;
    }
    const confirmed = window.confirm(`Sincronizar ${targets.length} dispositivo(s) do(s) cliente(s) selecionado(s)?`);
    if (!confirmed) return;
    setBatchSyncing(true);
    setBatchProgress({ total: targets.length, completed: 0 });

    const deviceById = new Map<string, any>();
    const deviceByName = new Map<string, any>();
    targets.forEach((device: any) => {
      deviceById.set(String(device.id), device);
      if (device?.name) deviceByName.set(String(device.name), device);
    });

    const incrementProgress = (count: number = 1) => {
      setBatchProgress((prev) => ({ total: prev.total, completed: prev.completed + count }));
    };

    for (const tenant of tenants) {
      const tenantTargets = targets.filter((device: any) => device?.tenant === tenant);
      if (tenantTargets.length === 0) continue;
      const netboxIds = tenantTargets.map((device: any) => device.id);
      try {
        const res = await api.syncJumpserverTenant({
          tenantName: tenant,
          netboxIds,
          confirm: true,
        });
        const results = Array.isArray(res?.results) ? res.results : [];
        if (results.length === 0) {
          tenantTargets.forEach((device: any) => {
            recordPendency(device, "Falha ao sincronizar em lote para o tenant.");
            incrementProgress();
          });
          continue;
        }
        for (const result of results) {
          const resultId = result?.netboxId ?? result?.deviceId;
          const device = resultId != null
            ? deviceById.get(String(resultId)) || deviceByName.get(String(result?.name))
            : deviceByName.get(String(result?.name));
          if (result?.status === "success") {
            if (device) clearPendency(device);
            const removalId = resultId != null ? resultId : device?.id;
            if (removalId != null) removeDeviceFromAudit(removalId);
          } else {
            recordPendency(device || { id: resultId, name: result?.name, tenant }, result?.error || "Falha desconhecida");
          }
          incrementProgress();
        }
      } catch (error: any) {
        tenantTargets.forEach((device: any) => {
          recordPendency(device, error?.message || "Falha ao sincronizar tenant.");
          incrementProgress();
        });
        toast.error(`Falha ao sincronizar tenant ${tenant}: ${error?.message || "erro desconhecido"}`);
      }
    }

    setBatchSyncing(false);
    setBatchProgress({ total: 0, completed: 0 });
  };

  useEffect(() => {
    fetchAudit();
  }, []);

  useEffect(() => {
    if (!showTenantDropdown) return;
    const handleClick = (event: MouseEvent) => {
      if (!tenantDropdownRef.current) return;
      if (!tenantDropdownRef.current.contains(event.target as Node)) {
        setShowTenantDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTenantDropdown]);

  return (
    <div className="space-y-6">
      {showHeader && (
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">HUB Operacional</h1>
            <p className="text-muted-foreground">
              Central de operações e integridade de dados (FastAPI Powered).
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] animate-pulse">
            HUB_DEBUG_V1
          </Badge>
        </div>
      )}

      {loadingAudit && !auditData && (
        <div className="flex items-center gap-2 p-4 bg-blue-500/10 text-blue-500 rounded-lg text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando dados da auditoria...
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">NetBox Devices</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{auditData?.summary?.netbox_devices_analyzed || "..."}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Conformidade (JS)</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {auditData?.summary
                ? (auditData.summary.netbox_devices_analyzed || 0) - (auditData.summary.missing_count || 0)
                : "..."}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inconsistências (JS)</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{auditData?.summary?.missing_count ?? "0"}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="audit" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="audit" onClick={fetchAudit} className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Sanity Check
          </TabsTrigger>
          <TabsTrigger value="movidesk" onClick={fetchSyncReport} className="gap-2">
            <UserCheck className="h-4 w-4" /> Sincronização Movidesk
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Netbox vs JumpServer</CardTitle>
                <CardDescription>
                  Dispositivos documentados no Netbox mas ausentes no JumpServer.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {tenantTargetCount > 0 && (
                  <Button size="sm" variant="secondary" onClick={handleTenantBulkSync} disabled={batchSyncing}>
                    {batchSyncing ? "Sincronizando..." : `Sincronizar cliente (${tenantTargetCount})`}
                  </Button>
                )}
                {selectedFilteredCount > 0 && (
                  <Button size="sm" onClick={handleBulkSync} disabled={batchSyncing}>
                    {batchSyncing ? "Sincronizando..." : `Sincronizar (${selectedFilteredCount})`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchAudit}
                  disabled={loadingAudit}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingAudit ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Clientes:</span>
                  <div className="relative" ref={tenantDropdownRef}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTenantDropdown((prev) => !prev)}
                      className="gap-2"
                    >
                      {tenantFilter.length > 0 ? `Clientes (${tenantFilter.length})` : "Todos os clientes"}
                    </Button>
                    {showTenantDropdown && (
                      <div className="absolute z-10 mt-2 w-64 rounded-md border bg-background p-2 shadow-md">
                        <div className="mb-2 flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={selectAllTenants}
                            disabled={tenantOptions.length === 0}
                          >
                            Todos
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearTenantFilter}
                            disabled={tenantFilter.length === 0}
                          >
                            Limpar
                          </Button>
                        </div>
                        <div className="max-h-48 space-y-1 overflow-auto">
                          {tenantOptions.length > 0 ? (
                            tenantOptions.map((tenant) => (
                              <label key={tenant} className="flex items-center gap-2 text-xs">
                                <Checkbox
                                  checked={tenantFilter.includes(tenant)}
                                  onCheckedChange={() => toggleTenantFilter(tenant)}
                                />
                                {tenant}
                              </label>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">Nenhum cliente encontrado</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Buscar:</span>
                  <Input
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Nome ou IP"
                    className="h-8 w-48"
                  />
                </div>
              </div>
              {batchProgress.total > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Sincronizando {batchProgress.completed}/{batchProgress.total}</span>
                    <span>{Math.round((batchProgress.completed / Math.max(batchProgress.total, 1)) * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 w-full rounded bg-muted">
                    <div
                      className="h-1 rounded bg-emerald-500 transition-all"
                      style={{ width: `${Math.round((batchProgress.completed / Math.max(batchProgress.total, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {syncPendencies.length > 0 && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertCircle className="h-4 w-4" />
                  Pendencias apos a sincronizacao: {syncPendencies.length}. Veja a lista abaixo.
                </div>
              )}
              {filteredDevices.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={(checked) => toggleSelectAllFiltered(!!checked)}
                        />
                      </TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>IP Primary</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDevices.map((device: any) => (
                      <TableRow key={device.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedDevices.includes(String(device.id))}
                            onCheckedChange={() => toggleDeviceSelection(device.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-xs lg:text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{device.name}</span>
                            {importedDevices[device.id] && (
                              <Badge variant="outline" className="text-[10px]">
                                Importado do NetBox
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs lg:text-sm">{device.ip}</TableCell>
                        <TableCell className="text-xs lg:text-sm">{device.site}</TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-[10px] lg:text-xs">
                            Missing JS
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSyncDevice(device)}
                            disabled={!!syncingDevices[device.id]}
                          >
                            {syncingDevices[device.id] ? (
                              <span className="flex items-center gap-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Sincronizando...
                              </span>
                            ) : (
                              "Sincronizar"
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : missingDevices.length > 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="h-10 w-10 text-muted-foreground mb-3" />
                  <h3 className="text-lg font-semibold">Nenhum resultado</h3>
                  <p className="text-muted-foreground">
                    Ajuste o filtro de clientes ou a busca para encontrar dispositivos.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                  <h3 className="text-lg font-semibold">Tudo em ordem!</h3>
                  <p className="text-muted-foreground">
                    Todos os dispositivos do Netbox possuem acesso configurado no JumpServer.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {syncPendencies.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Pendencias apos a sincronia</CardTitle>
                  <CardDescription>
                    Itens que precisam de revisao manual apos a tentativa de sincronizacao.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={clearAllPendencies}>
                  Limpar lista
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispositivo</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Atualizado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncPendencies.map((item) => (
                      <TableRow key={item.key}>
                        <TableCell className="font-medium text-xs lg:text-sm">{item.name}</TableCell>
                        <TableCell className="text-xs lg:text-sm">{item.ip}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.reason}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="movidesk">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Sincronização Movidesk</CardTitle>
                <CardDescription>
                  Auditoria entre Movidesk, NetBox e JumpServer (/DEFAULT/PRODUÇÃO).
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-muted/20">
                  <Checkbox
                    id="show-all"
                    checked={showAllSync}
                    onCheckedChange={(checked) => setShowAllSync(!!checked)}
                  />
                  <label htmlFor="show-all" className="text-xs font-medium cursor-pointer">
                    Exibir Tudo (incluir OK)
                  </label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchSyncReport}
                  disabled={loadingSync}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingSync ? "animate-spin" : ""}`} />
                  Scan
                </Button>
                {selectedSync.length > 0 && (
                  <Button
                    size="sm"
                    onClick={handleApproveSync}
                    disabled={executingSync}
                    className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {executingSync ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Autorizar {selectedSync.length} Ações
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loadingSync ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-12 w-12 text-blue-500 animate-spin mb-4" />
                  <p className="text-muted-foreground animate-pulse">
                    Comparando Movidesk com Sistemas Locais...
                  </p>
                </div>
              ) : syncReport?.actions?.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                        {syncReport.actions.filter((a: any) => a.status === "synced").length} Sincronizados
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">
                        {syncReport.actions.filter((a: any) => a.status !== "synced").length} Pendentes
                      </Badge>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox
                            checked={
                              selectedSync.length > 0 &&
                              selectedSync.length === syncReport.actions.filter((a: any) => a.status !== "synced").length
                            }
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedSync(
                                  syncReport.actions
                                    .filter((a: any) => a.status !== "synced")
                                    .map((a: any) => a.id)
                                );
                              } else {
                                setSelectedSync([]);
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Cliente (Movidesk)</TableHead>
                        <TableHead>CNPJ</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncReport.actions
                        .filter((a: any) => showAllSync || a.status !== "synced")
                        .map((action: any) => (
                          <TableRow
                            key={action.id}
                            className={action.status === "synced" ? "opacity-60 bg-muted/30" : ""}
                          >
                            <TableCell>
                              {action.status !== "synced" && (
                                <Checkbox
                                  checked={selectedSync.includes(action.id)}
                                  onCheckedChange={() => toggleSelection(action.id)}
                                />
                              )}
                              {action.status === "synced" && (
                                <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium text-xs lg:text-sm">
                              {action.client_name}
                              <p className="text-[10px] text-muted-foreground">ID: {action.movidesk_id}</p>
                            </TableCell>
                            <TableCell className="text-xs lg:text-sm">{action.cnpj}</TableCell>
                            <TableCell>
                              {action.status === "synced" ? (
                                <Badge
                                  variant="outline"
                                  className="bg-green-500/10 text-green-600 border-green-200 text-[10px]"
                                >
                                  OK
                                </Badge>
                              ) : action.status === "pending_create" ? (
                                <Badge
                                  variant="outline"
                                  className="bg-blue-500/10 text-blue-600 border-blue-200 text-[10px]"
                                >
                                  Novo
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="bg-amber-500/10 text-amber-600 border-amber-200 text-[10px]"
                                >
                                  Update
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground italic">
                              {action.details}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">Nenhum dado</h3>
                  <p className="text-muted-foreground">Clique em Scan para buscar empresas no Movidesk.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OperationalHubPanel;
