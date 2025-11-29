import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, HardDrive, Loader2, RefreshCw, ShieldCheck, XCircle, History, GitCompare, FileDiff, Eye, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTenantContext } from "@/contexts/TenantContext";

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
  };
  managed: boolean;
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

export default function Backup() {
  const [devices, setDevices] = useState<BackupDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<BackupDevice | null>(null);
  const [versions, setVersions] = useState<OxidizedVersion[]>([]);
  const [integration, setIntegration] = useState<BackupApiResponse["oxidized"]>({ available: true, message: null });
  const [routerDbInfo, setRouterDbInfo] = useState<BackupApiResponse["routerDb"]>({ writable: true, error: null });

  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Diff state
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'diff' | 'content'>('diff');
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><HardDrive className="h-6 w-6" />Backup</h1>
            <p className="text-muted-foreground mt-2">Gerencie quais dispositivos serão enviados ao Oxidized para backup diário.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadData} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>

        {(!integration.available || !routerDbInfo.writable) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Integração parcial</AlertTitle>
            <AlertDescription>
              {!integration.available && (<p>Oxidized API indisponível: {integration.message || 'verifique OXIDIZED_API_URL.'}</p>)}
              {!routerDbInfo.writable && (<p>Não foi possível atualizar {routerDbInfo.path || 'router.db'}: {routerDbInfo.error || 'verifique permissões.'}</p>)}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dispositivos monitorados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispositivo</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Status Oxidized</TableHead>
                    <TableHead>Último backup</TableHead>
                    <TableHead className="text-center">Habilitar</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" /> Carregando dispositivos...
                      </TableCell>
                    </TableRow>
                  ) : devices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        Nenhum dispositivo encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    devices.map((device) => {
                      const status = statusBadge(device.oxidized?.status);
                      return (
                        <TableRow key={device.id} className={selectedDevice?.id === device.id ? 'bg-muted/30' : ''}>
                          <TableCell>
                            <div className="font-medium">{device.name}</div>
                            <div className="text-xs text-muted-foreground">{device.manufacturer} · {device.model}</div>
                          </TableCell>
                          <TableCell>{device.ipAddress}</TableCell>
                          <TableCell>
                            <Badge className={status.className}>{status.text}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(device.oxidized?.lastRun)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={device.backupEnabled}
                              disabled={togglingId === device.id || !device.hasCredPassword}
                              onCheckedChange={(value) => handleToggle(device, value)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Button variant="ghost" size="sm" className="gap-2" onClick={() => showVersions(device)}>
                              <History className="h-4 w-4" /> Versões
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
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

                      try {
                        if (selectedVersions.length === 2) {
                          setViewMode('diff');
                          const res = await api.getBackupDiff(selectedDevice.name, selectedVersions[1], selectedVersions[0]);
                          setDiffContent(res?.diff || 'Sem diferenças.');
                        } else {
                          setViewMode('content');
                          const res = await api.getBackupContent(selectedDevice.name, selectedVersions[0]);
                          setDiffContent(res?.content || 'Conteúdo vazio.');
                        }
                      } catch (err) {
                        setDiffContent('Erro ao carregar: ' + (err instanceof Error ? err.message : String(err)));
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
      </div >

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
    </DashboardLayout >
  );
}
