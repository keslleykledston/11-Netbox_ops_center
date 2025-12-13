import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, HardDrive, Loader2, RefreshCw, ShieldCheck, XCircle, History, GitCompare, FileDiff, Eye, Search, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

import { useTenantContext } from "@/contexts/TenantContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BackupDevice {
  id: number;
  name: string;
  ipAddress: string;
  manufacturer: string;
  model: string;
  backupEnabled: boolean;
  sshPort?: number | null;
  credUsername?: string | null;
  hasCredPassword?: boolean;
  oxidized: {
    present: boolean;
    status: string;
    lastRun: string | null;
    lastVersion?: string | null;
  };
  managed: boolean;
  tenant?: { id: number; name: string } | null;
}

interface BackupApiResponse {
  items: BackupDevice[];
  oxidized: { available: boolean; message: string | null; baseUrl?: string | null };
  routerDb: { path?: string; writable: boolean; error: string | null };
}

interface OxidizedVersion {
  num?: number;
  time?: string;
  date?: string;
  status?: string;
  oid?: string;
}

interface BackupLog {
  id?: number;
  timestamp: string;
  event: string;
  device: string;
  status: string;
  message?: string;
  proxyName?: string;
  hasChanges?: boolean;
}

const statusBadge = (status?: string) => {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'success') return { text: 'OK', className: 'bg-emerald-500/10 text-emerald-500' };
  if (normalized === 'never' || normalized === 'inactive') return { text: 'Nunca', className: 'bg-muted text-muted-foreground' };
  return { text: normalized || 'pendente', className: 'bg-amber-500/10 text-amber-500' };
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleString();
  } catch {
    return '--';
  }
};

const formatOxidizedTimestamp = (dateStr: string | null | undefined) => {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--';
    const pad = (val: number) => String(val).padStart(2, '0');
    return `${pad(d.getDate())}:${pad(d.getMonth() + 1)}:${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '--';
  }
};

export default function Backup() {
  const [devices, setDevices] = useState<BackupDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<BackupDevice | null>(null);
  const [versions, setVersions] = useState<OxidizedVersion[]>([]);
  const [integration, setIntegration] = useState<BackupApiResponse["oxidized"]>({ available: true, message: null });
  const [routerDbInfo, setRouterDbInfo] = useState<BackupApiResponse["routerDb"]>({ writable: true, error: null });



  const [togglingId, setTogglingId] = useState<number | null>(null);

  // UI Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilter, setTenantFilter] = useState<string>('all');

  // Diff state
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff');

  const [artifactInfo, setArtifactInfo] = useState<{ path?: string | null; paths?: string[]; repo?: string | null }>({});

  // Logs state
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [logsDevice, setLogsDevice] = useState<BackupDevice | null>(null);
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const { toast } = useToast();
  const { selectedTenantId, loading: tenantLoading } = useTenantContext();

  const loadData = async () => {
    try {
      setLoading(true);
      const resp = await api.listBackupDevices(selectedTenantId || undefined) as BackupApiResponse;
      setDevices(resp.items || []);
      setIntegration(resp.oxidized || { available: true, message: null });
      setRouterDbInfo(resp.routerDb || { writable: true, error: null });
      if (selectedDevice) {
        const refreshed = resp.items?.find((d) => d.id === selectedDevice.id) || null;
        setSelectedDevice(refreshed);
        if (refreshed) await loadVersions(refreshed.id, refreshed);
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao carregar backups", description: err instanceof Error ? err.message : 'Falha inesperada', variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantLoading) return;
    loadData();
  }, [selectedTenantId, tenantLoading]);

  const loadVersions = async (id: number, device?: BackupDevice | null) => {
    try {
      setVersionsLoading(true);
      const list = await api.getBackupVersions(id) as OxidizedVersion[];
      setVersions(Array.isArray(list) ? list : []);
      if (device) setSelectedDevice(device);
    } catch (err) {
      console.error(err);
      toast({ title: "Não foi possível carregar versões", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleToggle = async (device: BackupDevice, enabled: boolean) => {
    try {
      setTogglingId(device.id);
      await api.updateBackupDevice(device.id, { enabled });
      toast({ title: enabled ? 'Backup ativado' : 'Backup desativado', description: `${device.name} atualizado.` });
      await loadData();
    } catch (err) {
      toast({ title: "Erro ao atualizar backup", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  const showVersions = async (device: BackupDevice) => {
    setSelectedDevice(device);
    await loadVersions(device.id, device);
  };

  const showLogs = async (device: BackupDevice) => {
    setLogsDevice(device);
    setLogsModalOpen(true);
    setLogsLoading(true);

    try {
      const logData = await api.getDeviceBackupLogs(device.id, 100);
      setLogs(Array.isArray(logData) ? logData : []);
    } catch (err) {
      console.error(err);
      toast({ title: "Erro ao carregar logs", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const uniqueTenants = Array.from(new Set(devices.map(d => d.tenant?.name).filter(Boolean))).sort();

  const filteredDevices = devices.filter(device => {
    const matchesSearch =
      device.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.ipAddress.includes(searchTerm) ||
      (device.tenant?.name || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTenant = tenantFilter === 'all' || device.tenant?.name === tenantFilter;

    return matchesSearch && matchesTenant;
  });

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backup</h1>
          <p className="text-muted-foreground">Gerencie o backup automático dos dispositivos via Oxidized.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {/* Cards remain same */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dispositivos Configurados</CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{devices.filter(d => d.backupEnabled).length}</div>
            <p className="text-xs text-muted-foreground">de {devices.length} total</p>
          </CardContent>
        </Card>
      </div>

      {integration.available === false && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Oxidized Indisponível</AlertTitle>
          <AlertDescription>
            Não foi possível comunicar com o serviço Oxidized. {integration.message && `Erro: ${integration.message}`}
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, IP ou tenant..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="w-[200px]">
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por Tenant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Tenants</SelectItem>
              {uniqueTenants.map(t => (
                <SelectItem key={t} value={t as string}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Dispositivos Monitorados</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispositivo</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status Oxidized</TableHead>
                    <TableHead>Último backup</TableHead>
                    <TableHead>Habilitar</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          <span className="text-muted-foreground">Carregando dispositivos...</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredDevices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nenhum dispositivo encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDevices.map((device) => {
                      const status = statusBadge(device.oxidized.status);
                      const isProcessing = togglingId === device.id;

                      return (
                        <TableRow key={device.id}>
                          <TableCell>
                            <div className="font-medium">{device.name}</div>
                            <div className="text-xs text-muted-foreground">{device.manufacturer} · {device.model}</div>
                          </TableCell>
                          <TableCell>{device.ipAddress}</TableCell>
                          <TableCell>
                            {device.tenant ? <Badge variant="outline">{device.tenant.name}</Badge> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={status.className}>{status.text}</Badge>
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground leading-tight">
                            <div>Última coleta: {formatOxidizedTimestamp(device.oxidized?.lastRun)}</div>
                            <div>Última versão: {formatOxidizedTimestamp(device.oxidized?.lastVersion)}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={device.backupEnabled}
                              disabled={togglingId === device.id || !device.hasCredPassword}
                              onCheckedChange={(value) => handleToggle(device, value)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex gap-2 justify-center">
                              <Button variant="ghost" size="sm" className="gap-2" onClick={() => showVersions(device)}>
                                <History className="h-4 w-4" /> Versões
                              </Button>
                              <Button variant="ghost" size="sm" className="gap-2" onClick={() => showLogs(device)}>
                                <FileText className="h-4 w-4" /> Logs
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Versionamento</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedDevice ? (
                <div className="text-muted-foreground text-sm">Selecione um dispositivo para visualizar as versões armazenadas no Oxidized.</div>
              ) : versionsLoading ? (
                <div className="flex items-center text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando versões...</div>
              ) : versions.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />Nenhum histórico disponível para {selectedDevice.name}.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="text-sm text-muted-foreground">
                      Selecione até 2 versões para comparar.
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={selectedVersions.length === 0 || selectedVersions.length > 2}
                      onClick={async () => {
                        if (selectedVersions.length === 0 || !selectedDevice) return;

                        setDiffModalOpen(true);
                        setDiffLoading(true);
                        setSearchTerm('');
                        setArtifactInfo({});

                        try {
                          if (selectedVersions.length === 2) {
                            setViewMode('diff');
                            const res = await api.getBackupDiff(selectedDevice.name, selectedVersions[1], selectedVersions[0]);
                            setDiffContent(res?.diff || 'Sem diferenças.');
                            setArtifactInfo({ path: res?.path, paths: res?.paths, repo: res?.repo });
                          } else {
                            setViewMode('content');
                            const res = await api.getBackupContent(selectedDevice.name, selectedVersions[0]);
                            setDiffContent(res?.content || 'Conteúdo vazio.');
                            setArtifactInfo({ path: res?.path, paths: res?.paths, repo: res?.repo });
                          }
                        } catch (err) {
                          setDiffContent('Erro ao carregar: ' + (err instanceof Error ? err.message : String(err)));
                          setArtifactInfo({});
                        } finally {
                          setDiffLoading(false);
                        }
                      }}
                    >
                      {selectedVersions.length === 2 ? <GitCompare className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                      {selectedVersions.length === 2 ? 'Comparar (2)' : 'Visualizar (1)'}
                    </Button>
                  </div>

                  <ScrollArea className="h-60 border rounded-md">
                    <div className="p-2 space-y-1">
                      {versions.map((version, index) => {
                        const oid = version.oid || '';
                        const isSelected = selectedVersions.includes(oid);
                        return (
                          <div
                            key={`${oid || index}`}
                            className={`flex items-center justify-between p-2 rounded-md border ${isSelected ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                            onClick={() => {
                              if (!oid) return;
                              if (isSelected) {
                                setSelectedVersions(prev => prev.filter(v => v !== oid));
                              } else {
                                if (selectedVersions.length < 2) {
                                  setSelectedVersions(prev => [oid, ...prev]); // Add to start
                                } else {
                                  toast({ title: "Limite atingido", description: "Você só pode selecionar 2 versões para comparar." });
                                }
                              }
                            }}
                          >
                            <div className="flex items-center gap-3 cursor-pointer flex-1">
                              <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'}`}>
                                {isSelected && <div className="w-2 h-2 bg-current rounded-full" />}
                              </div>
                              <div>
                                <div className="font-medium text-sm">Versão #{version.num ?? versions.length - index}</div>
                                <div className="text-xs text-muted-foreground">{version.time || version.date || 'Sem data'}</div>
                              </div>
                            </div>
                            <Badge variant="secondary" className="text-xs">{version.status || 'snapshot'}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )
              }
            </CardContent >
          </Card >

          {
            devices.some((d) => d.backupEnabled && d.hasCredPassword) && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Segurança</AlertTitle>
                <AlertDescription>As senhas são armazenadas com criptografia forte (AES-256-GCM).</AlertDescription>
              </Alert>
            )
          }
        </div>
      </div>

      {/* Diff/Content Modal */}
      <Dialog open={diffModalOpen} onOpenChange={setDiffModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewMode === 'diff' ? <FileDiff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              {viewMode === 'diff' ? 'Comparação de Versões' : 'Visualização de Backup'}
            </DialogTitle>
            <DialogDescription>
              {viewMode === 'diff'
                ? `Comparando as versões selecionadas do dispositivo ${selectedDevice?.name}.`
                : `Visualizando conteúdo da versão selecionada do dispositivo ${selectedDevice?.name}.`
              }
            </DialogDescription>
          </DialogHeader>

          {viewMode === 'content' && (
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar no conteúdo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          )}

          <div className="flex-1 overflow-auto bg-muted/50 p-4 rounded-md border font-mono text-xs whitespace-pre-wrap">
            {(artifactInfo.path || (artifactInfo.paths && artifactInfo.paths.length > 0) || artifactInfo.repo) && (
              <div className="mb-3 font-sans text-[11px] text-muted-foreground">
                {artifactInfo.path && <div>Arquivo encontrado: {artifactInfo.path}</div>}
                {artifactInfo.repo && <div>Repositório: {artifactInfo.repo}</div>}
                {artifactInfo.paths && artifactInfo.paths.length > 1 && (
                  <div className="mt-1">
                    Outras correspondências: {artifactInfo.paths.filter((p) => p !== artifactInfo.path).join(', ')}
                  </div>
                )}
              </div>
            )}
            {diffLoading ? (
              <div className="flex items-center justify-center h-20 gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Carregando...
              </div>
            ) : diffContent ? (
              viewMode === 'content' && searchTerm ? (
                (() => {
                  const filteredLines = diffContent.split('\n').map((line, i) => {
                    if (!line.toLowerCase().includes(searchTerm.toLowerCase())) return null;
                    const parts = line.split(new RegExp(`(${searchTerm})`, 'gi'));
                    return (
                      <div key={i} className="border-b border-border/50 pb-0.5 mb-0.5">
                        <span className="text-muted-foreground mr-2 select-none w-8 inline-block text-right">{i + 1}</span>
                        {parts.map((part, j) =>
                          part.toLowerCase() === searchTerm.toLowerCase()
                            ? <span key={j} className="bg-yellow-500/30 text-yellow-500 font-bold">{part}</span>
                            : part
                        )}
                      </div>
                    );
                  }).filter(Boolean);

                  return filteredLines.length > 0 ? (
                    filteredLines
                  ) : (
                    <div className="text-muted-foreground italic">Nenhum resultado encontrado para "{searchTerm}".</div>
                  );
                })()
              ) : (
                diffContent
              )
            ) : (
              <div className="text-center text-muted-foreground">Nenhum conteúdo disponível.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Logs Modal */}
      <Dialog open={logsModalOpen} onOpenChange={setLogsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Histórico de Backups
            </DialogTitle>
            <DialogDescription>
              Histórico de coletas de backup para o dispositivo {logsDevice?.name} ({logsDevice?.ipAddress})
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {logsLoading ? (
              <div className="flex items-center justify-center h-32 gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Carregando logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Nenhum log de backup encontrado para este dispositivo.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log, index) => {
                  const isSuccess = log.status === 'success' || log.event === 'backup_success';
                  const isFailed = log.status === 'error' || log.event === 'backup_fail';

                  return (
                    <div
                      key={log.id || index}
                      className={`p-4 rounded-lg border ${isSuccess ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' :
                        isFailed ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
                          'bg-muted/50'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="mt-1">
                            {isSuccess ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            ) : isFailed ? (
                              <AlertCircle className="h-5 w-5 text-red-600" />
                            ) : (
                              <AlertTriangle className="h-5 w-5 text-yellow-600" />
                            )}
                          </div>

                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">
                                {log.event === 'backup_success' ? 'Backup realizado com sucesso' :
                                  log.event === 'backup_fail' ? 'Falha no backup' :
                                    log.event}
                              </span>

                              {log.hasChanges !== undefined && (
                                <Badge variant={log.hasChanges ? "default" : "secondary"} className="text-xs">
                                  {log.hasChanges ? '✓ Com alterações' : '— Sem alterações'}
                                </Badge>
                              )}

                              {log.proxyName && (
                                <Badge variant="outline" className="text-xs">
                                  {log.proxyName}
                                </Badge>
                              )}
                            </div>

                            <div className="text-xs text-muted-foreground">
                              {formatDate(log.timestamp)}
                            </div>

                            {log.message && (
                              <div className="text-sm text-muted-foreground mt-2 font-mono bg-background/50 p-2 rounded">
                                {log.message}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout >
  );
}
