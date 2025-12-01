import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Terminal, Trash2, RefreshCw, Server, Copy, CheckCircle2, XCircle, Clock, Settings, Zap } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface OxidizedProxy {
  id: number;
  name: string;
  siteId: string;
  endpoint: string | null;
  gitRepoUrl: string | null;
  status: string;
  lastSeen: Date | null;
  interval: number;
  deviceCount?: number;
  _count?: {
    devices: number;
  };
}

const OxidizedProxy = () => {
  const { toast } = useToast();
  const [proxies, setProxies] = useState<OxidizedProxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProxy, setEditingProxy] = useState<OxidizedProxy | null>(null);
  const [form, setForm] = useState({ name: "", siteId: "", gitRepoUrl: "" });
  const [intervalForm, setIntervalForm] = useState({ interval: 1800 });

  useEffect(() => {
    fetchProxies();
  }, []);

  const fetchProxies = async () => {
    try {
      setLoading(true);
      const response = await api.listOxidizedProxies();
      setProxies(response);
    } catch (error) {
      toast({
        title: "Erro ao carregar proxies",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createProxy = async () => {
    if (!form.name || !form.siteId) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e Site ID são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    try {
      await api.createOxidizedProxy(form);
      toast({
        title: "Proxy criado",
        description: "O proxy foi criado com sucesso",
      });
      setShowModal(false);
      setForm({ name: "", siteId: "", gitRepoUrl: "" });
      fetchProxies();
    } catch (error) {
      toast({
        title: "Erro ao criar proxy",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const deleteProxy = async (id: number) => {
    if (!confirm("Tem certeza que deseja remover este proxy?")) return;

    try {
      await api.deleteOxidizedProxy(id);
      toast({
        title: "Proxy removido",
        description: "O proxy foi removido com sucesso",
      });
      fetchProxies();
    } catch (error) {
      toast({
        title: "Erro ao remover proxy",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const showDeployScript = async (id: number) => {
    try {
      const script = await api.getOxidizedProxyDeployScript(id);
      await navigator.clipboard.writeText(script);
      toast({
        title: "Script copiado!",
        description: "O script de deploy foi copiado para a área de transferência",
      });
    } catch (error) {
      toast({
        title: "Erro ao copiar script",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const openEditInterval = (proxy: OxidizedProxy) => {
    setEditingProxy(proxy);
    setIntervalForm({ interval: proxy.interval || 1800 });
    setShowEditModal(true);
  };

  const saveInterval = async () => {
    if (!editingProxy) return;

    try {
      await api.updateOxidizedProxy(editingProxy.id, { interval: intervalForm.interval });
      toast({
        title: "Intervalo atualizado",
        description: `O intervalo foi atualizado para ${formatInterval(intervalForm.interval)}`,
      });
      setShowEditModal(false);
      setEditingProxy(null);
      fetchProxies();
    } catch (error) {
      toast({
        title: "Erro ao atualizar intervalo",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const formatInterval = (seconds: number): string => {
    if (seconds < 60) return `${seconds} segundos`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutos`;
    return `${Math.floor(seconds / 3600)} hora(s)`;
  };

  const syncProxy = async (id: number) => {
    setSyncing(id);
    try {
      const result = await api.syncOxidizedProxy(id);
      toast({
        title: "Sincronização concluída",
        description: result.message || "Proxy sincronizado com sucesso",
      });
    } catch (error) {
      toast({
        title: "Erro ao sincronizar",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
    }
  };

  const syncAllProxies = async () => {
    setSyncingAll(true);
    try {
      const result = await api.syncAllOxidizedProxies();
      toast({
        title: "Sincronização em massa concluída",
        description: `${result.synced} de ${result.total} proxies sincronizados`,
      });
    } catch (error) {
      toast({
        title: "Erro ao sincronizar proxies",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setSyncingAll(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "offline":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "pending":
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "offline":
        return "bg-red-100 text-red-800";
      case "pending":
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Oxidized Proxies</h1>
            <p className="text-muted-foreground">Gerencie proxies distribuídos para coleta de backup</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchProxies} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Atualizar
            </Button>
            <Button
              onClick={syncAllProxies}
              variant="outline"
              size="sm"
              disabled={syncingAll || proxies.length === 0}
            >
              {syncingAll ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Sincronizar Todos
            </Button>
            <Button onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Proxy
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : proxies.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-64">
              <Server className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Nenhum proxy configurado</p>
              <Button onClick={() => setShowModal(true)} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Criar primeiro proxy
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {proxies.map((proxy) => (
              <Card key={proxy.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        {proxy.name}
                      </CardTitle>
                      <CardDescription>Site: {proxy.siteId}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => syncProxy(proxy.id)}
                        variant="outline"
                        size="sm"
                        title="Sincronizar agora"
                        disabled={syncing === proxy.id || !proxy.endpoint}
                      >
                        {syncing === proxy.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        onClick={() => openEditInterval(proxy)}
                        variant="outline"
                        size="sm"
                        title="Configurar intervalo"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => showDeployScript(proxy.id)}
                        variant="outline"
                        size="sm"
                        title="Copiar script de deploy"
                      >
                        <Terminal className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => deleteProxy(proxy.id)}
                        variant="outline"
                        size="sm"
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <div className="flex items-center gap-2 mt-1">
                        {getStatusIcon(proxy.status)}
                        <span className={`text-xs px-2 py-1 rounded ${getStatusBadgeColor(proxy.status)}`}>
                          {proxy.status}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Dispositivos</p>
                      <p className="font-semibold">{proxy._count?.devices || 0}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Intervalo</p>
                      <p className="font-semibold">{formatInterval(proxy.interval || 1800)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Endpoint</p>
                      <p className="font-semibold text-xs">{proxy.endpoint || "—"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Git Repo</p>
                      <p className="font-semibold text-xs truncate" title={proxy.gitRepoUrl || ""}>
                        {proxy.gitRepoUrl || "—"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Oxidized Proxy</DialogTitle>
            <DialogDescription>
              Configure um novo proxy para coleta de backups em site remoto
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Nome do Proxy *</Label>
              <Input
                id="name"
                placeholder="Ex: Filial São Paulo"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="siteId">Site ID *</Label>
              <Input
                id="siteId"
                placeholder="Ex: filial-sp-01"
                value={form.siteId}
                onChange={(e) => setForm({ ...form, siteId: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Identificador único do proxy (apenas letras, números e hífens)
              </p>
            </div>

            <div>
              <Label htmlFor="gitRepoUrl">Git Repository URL</Label>
              <Input
                id="gitRepoUrl"
                placeholder="Ex: git@github.com:user/backups.git"
                value={form.gitRepoUrl}
                onChange={(e) => setForm({ ...form, gitRepoUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                URL do repositório Git para armazenar backups (opcional)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button onClick={createProxy}>Criar Proxy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Intervalo de Backup</DialogTitle>
            <DialogDescription>
              {editingProxy && `Ajuste o intervalo de backup para ${editingProxy.name}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="interval">Intervalo (em segundos)</Label>
              <Input
                id="interval"
                type="number"
                min="300"
                max="86400"
                value={intervalForm.interval}
                onChange={(e) => setIntervalForm({ interval: parseInt(e.target.value) || 1800 })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Mínimo: 300 segundos (5 minutos) | Máximo: 86400 segundos (24 horas)
              </p>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Intervalos Comuns:</h4>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIntervalForm({ interval: 900 })}
                >
                  15 min (900s)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIntervalForm({ interval: 1800 })}
                >
                  30 min (1800s)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIntervalForm({ interval: 3600 })}
                >
                  1 hora (3600s)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIntervalForm({ interval: 7200 })}
                >
                  2 horas (7200s)
                </Button>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg">
              <p className="text-sm">
                <strong>Intervalo atual:</strong> {formatInterval(intervalForm.interval)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                ⚠️ Esta configuração só afeta novos deploys. Para proxies existentes, você precisará atualizar manualmente o arquivo de configuração.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>
              Cancelar
            </Button>
            <Button onClick={saveInterval}>Salvar Intervalo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default OxidizedProxy;
