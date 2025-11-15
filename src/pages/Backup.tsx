import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, HardDrive, Loader2, RefreshCw, ShieldCheck, XCircle, History } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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

export default function Backup() {
  const [devices, setDevices] = useState<BackupDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<BackupDevice | null>(null);
  const [versions, setVersions] = useState<OxidizedVersion[]>([]);
  const [integration, setIntegration] = useState<BackupApiResponse["oxidized"]>({ available: true, message: null });
  const [routerDbInfo, setRouterDbInfo] = useState<BackupApiResponse["routerDb"]>({ writable: true, error: null });
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const { toast } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const resp = await api.listBackupDevices() as BackupApiResponse;
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
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <Alert variant="warning">
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
                            {device.oxidized?.lastRun ? new Date(device.oxidized.lastRun).toLocaleString() : '--'}
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
              <ScrollArea className="h-60">
                <div className="space-y-3 pr-4">
                  {versions.map((version, index) => (
                    <div key={`${version.oid || version.time || index}`} className="border rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium">Versão #{version.num ?? versions.length - index}</div>
                        <div className="text-xs text-muted-foreground">{version.time || version.date || 'Sem data'}</div>
                      </div>
                      <Badge variant="secondary">{version.status || 'snapshot'}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {devices.some((d) => d.backupEnabled && d.hasCredPassword) && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Backup automático</AlertTitle>
            <AlertDescription>
              Dispositivos habilitados serão sincronizados no arquivo router.db automaticamente e terão backups diários no Oxidized.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </DashboardLayout>
  );
}
