import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, Server, MoreVertical, RefreshCw, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDevices } from "@/hooks/use-mobile";
import AddDeviceDialog from "@/components/devices/AddDeviceDialog";
import EditDeviceDialog from "@/components/devices/EditDeviceDialog";
import type { Device } from "@/lib/utils";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Devices() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { toast } = useToast();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(undefined);
  const { devices, loading, error, deleteDevice, refreshDevices } = useDevices(selectedTenantId);
  const navigate = useNavigate();

  useEffect(() => {
    // Carrega tenants de acordo com permissões do usuário
    api.listTenants().then((list: any[]) => {
      const mapped = (list || []).map((t: any) => ({ id: Number(t.id), name: String(t.name) }));
      setTenants(mapped);
      if (!selectedTenantId && mapped.length > 0) setSelectedTenantId(String(mapped[0].id));
    }).catch(() => setTenants([]));
  }, []);
  const openEditDialog = (device: Device) => {
    setSelectedDevice(device);
    setIsEditDialogOpen(true);
  };

  const filteredDevices = devices.filter((device) => {
    const term = searchTerm.toLowerCase();
    return (
      device.name.toLowerCase().includes(term) ||
      (device.hostname || "").toLowerCase().includes(term) ||
      device.ipAddress.includes(searchTerm) ||
      device.manufacturer.toLowerCase().includes(term) ||
      device.model.toLowerCase().includes(term)
    );
  });

  const handleRefreshDevices = async () => {
    try {
      await refreshDevices();
      toast({ title: "Dispositivos atualizados", description: "Lista de dispositivos atualizada com sucesso!" });
    } catch {
      toast({ title: "Erro ao atualizar", description: "Não foi possível atualizar a lista de dispositivos.", variant: "destructive" });
    }
  };

  const confirmDeleteDevice = async () => {
    if (!deviceToDelete) return;
    try {
      const success = await deleteDevice(deviceToDelete);
      if (success) {
        toast({ title: "Dispositivo removido", description: "Dispositivo removido com sucesso!" });
      } else {
        toast({ title: "Erro ao remover", description: "Dispositivo não encontrado.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro ao remover", description: "Não foi possível remover o dispositivo.", variant: "destructive" });
    } finally {
      setDeviceToDelete(null);
    }
  };

  const getStatusBadge = (status: Device['status']) => {
    if (status === 'active') return { bg: 'bg-success/10', fg: 'text-success', text: 'Ativo' };
    if (status === 'maintenance') return { bg: 'bg-warning/10', fg: 'text-warning', text: 'Manutenção' };
    return { bg: 'bg-warning/10', fg: 'text-warning', text: 'Inativo' };
  };

  const getMonitoringBadge = (monitoring?: Device['monitoring']) => {
    if (!monitoring) return { text: 'Sem dados', fg: 'text-muted-foreground' };
    switch (monitoring.state) {
      case 'up':
        return { text: 'UP', fg: 'text-success' };
      case 'down':
        return { text: 'DOWN', fg: 'text-destructive' };
      case 'unreachable':
        return { text: 'Inalcançável', fg: 'text-warning' };
      default:
        return { text: 'Desconhecido', fg: 'text-muted-foreground' };
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dispositivos</h1>
            <p className="text-muted-foreground mt-2">
              Gerencie os dispositivos de rede ({filteredDevices.length} dispositivos)
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleRefreshDevices}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
            <Button className="gap-2" onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Adicionar Dispositivo
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="p-4">
              <p className="text-destructive-foreground">{error}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar dispositivos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="w-[260px]">
                <Select value={selectedTenantId} onValueChange={(v) => { setSelectedTenantId(v); refreshDevices(); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o Tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Carregando dispositivos...</span>
                </div>
              ) : filteredDevices.length === 0 ? (
                <div className="text-center py-8">
                  <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {searchTerm ? "Nenhum dispositivo encontrado" : "Nenhum dispositivo cadastrado"}
                  </p>
                  {!searchTerm && (
                    <Button className="mt-4 gap-2" onClick={() => setIsAddDialogOpen(true)}>
                      <Plus className="h-4 w-4" />
                      Adicionar Primeiro Dispositivo
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredDevices.map((device) => {
                    const isActive = device.status === "active";
                    const isMaint = device.status === "maintenance";
                    const badgeBg = isActive ? "bg-success/10" : isMaint ? "bg-warning/10" : "bg-warning/10";
                    const badgeFg = isActive ? "text-success" : isMaint ? "text-warning" : "text-warning";
                    const badgeText = isActive ? "Ativo" : isMaint ? "Manutenção" : "Inativo";
                    const monitoringBadge = getMonitoringBadge(device.monitoring);

                    return (
                      <Card key={device.id} className="hover:bg-accent/50 transition-colors cursor-pointer">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${badgeBg}`}>
                                <Server className={`h-5 w-5 ${badgeFg}`} />
                              </div>
                              <div>
                                <CardTitle className="text-lg">{device.name}</CardTitle>
                                <CardDescription>{device.hostname || device.ipAddress}</CardDescription>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEditDialog(device)}>Editar</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/access/terminal?deviceId=${device.id}`)}>
                                  Terminal Web
                                </DropdownMenuItem>
                                <DropdownMenuItem>Configurações</DropdownMenuItem>
                                <DropdownMenuItem>Logs</DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeviceToDelete(device.id)}
                                >
                                  Remover
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-3">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Fabricante</span>
                              <span className="font-medium">{device.manufacturer}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Modelo</span>
                              <span className="font-medium">{device.model}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">IP</span>
                              <span className="font-medium">{device.ipAddress}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">SNMP</span>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{device.snmpVersion || "—"}</span>
                                {device.snmpStatus && (
                                  <div
                                    className={`h-2.5 w-2.5 rounded-full ${device.snmpStatus === 'ok' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
                                      device.snmpStatus === 'error' ? 'bg-red-500' : 'bg-zinc-600'
                                      }`}
                                    title={`Status SNMP: ${device.snmpStatus}`}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">SSH</span>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{device.sshPort || "22"}</span>
                                {device.sshStatus && (
                                  <div
                                    className={`h-2.5 w-2.5 rounded-full ${device.sshStatus === 'ok' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
                                      device.sshStatus === 'auth_error' ? 'bg-orange-500' :
                                        device.sshStatus === 'timeout' ? 'bg-yellow-500' :
                                          'bg-red-500'
                                      }`}
                                    title={`Status SSH: ${device.sshStatus}`}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Status</span>
                              <span className={`font-medium ${badgeFg}`}>{badgeText}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Monitoramento</span>
                              <span
                                className={`font-medium ${monitoringBadge.fg}`}
                                title={device.monitoring?.lastCheck ? `Última coleta: ${new Date(device.monitoring.lastCheck).toLocaleString()}` : undefined}
                              >
                                {monitoringBadge.text}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <AddDeviceDialog
          open={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
        />
        <EditDeviceDialog
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            if (!open) setSelectedDevice(null);
          }}
          device={selectedDevice}
        />

        <AlertDialog open={!!deviceToDelete} onOpenChange={(open) => !open && setDeviceToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Isso excluirá permanentemente o dispositivo
                e removerá seus dados de nossos servidores.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteDevice} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
