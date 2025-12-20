import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useTenantContext } from "@/contexts/TenantContext";
import { RefreshCw, Play, CheckCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const JumpserverSync = () => {
  const { toast } = useToast();
  const { selectedTenantId, isAdmin } = useTenantContext();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [mode, setMode] = useState<"full" | "incremental">("full");
  const [excludeInactive, setExcludeInactive] = useState(true);

  const loadStatus = async (id?: string | null) => {
    const target = id || jobId;
    if (!target) return;
    try {
      const res = await api.jumpserverSyncStatus(target);
      setJobStatus(res);
    } catch {
      setJobStatus(null);
    }
  };

  const loadPending = async (id?: string | null) => {
    const target = id || jobId;
    if (!target) return;
    setLoadingPending(true);
    try {
      const res = await api.jumpserverSyncPending(target, "pending");
      setPendingActions(res.actions || []);
    } catch (e) {
      toast({ title: "Falha ao carregar pendencias", description: String((e as any)?.message || e), variant: "destructive" });
    } finally {
      setLoadingPending(false);
    }
  };

  const startSync = async () => {
    if (!selectedTenantId) {
      toast({ title: "Selecione um tenant", description: "Defina o tenant ativo antes de iniciar.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await api.jumpserverSyncStart({
        mode,
        filters: { excludeInactive },
        tenantId: Number(selectedTenantId),
      });
      setJobId(res.jobId);
      toast({ title: "Sync iniciado", description: `Job ${res.jobId} com ${res.totalDevices} dispositivos.` });
      await loadStatus(res.jobId);
      await loadPending(res.jobId);
    } catch (e) {
      toast({ title: "Falha ao iniciar", description: String((e as any)?.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (actionId: string, decision: "approve" | "reject") => {
    if (!selectedTenantId && isAdmin) {
      toast({ title: "Selecione um tenant", description: "Defina o tenant ativo antes de aprovar.", variant: "destructive" });
      return;
    }
    try {
      await api.jumpserverSyncApprove(actionId, {
        action: decision,
        tenantId: selectedTenantId ? Number(selectedTenantId) : undefined,
      });
      await loadPending();
      await loadStatus();
      toast({ title: decision === "approve" ? "Aprovado" : "Rejeitado", description: `Ação ${decision} com sucesso.` });
    } catch (e) {
      toast({ title: "Falha ao atualizar ação", description: String((e as any)?.message || e), variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!jobId) return;
    loadStatus();
    loadPending();
    const timer = window.setInterval(() => {
      loadStatus();
      loadPending();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [jobId]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Sincronização JumpServer</h1>
          <p className="text-muted-foreground mt-2">
            Gere pendencias entre NetBox e JumpServer para validar antes de criar ou atualizar assets.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-2">
            <CardTitle>Iniciar sincronização</CardTitle>
            <CardDescription>
              Modo {mode === "full" ? "completo" : "incremental"}. Tenant ativo: {selectedTenantId || "global"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "full"}
                  onChange={() => setMode("full")}
                />
                Completo
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "incremental"}
                  onChange={() => setMode("incremental")}
                />
                Incremental
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={excludeInactive}
                  onChange={(e) => setExcludeInactive(e.target.checked)}
                />
                Ignorar inativos
              </label>
            </div>
            <Button onClick={startSync} disabled={loading} className="gap-2">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Iniciando..." : "Iniciar Sync"}
            </Button>
          </CardContent>
        </Card>

        {jobId && (
          <Card>
            <CardHeader>
              <CardTitle>Job ativo</CardTitle>
              <CardDescription>Job {jobId}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded border border-border/50 p-3">
                <p className="text-muted-foreground">Status</p>
                <p className="font-semibold">{jobStatus?.status || "-"}</p>
              </div>
              <div className="rounded border border-border/50 p-3">
                <p className="text-muted-foreground">Processados</p>
                <p className="font-semibold">{jobStatus?.processedDevices || 0} / {jobStatus?.totalDevices || 0}</p>
              </div>
              <div className="rounded border border-border/50 p-3">
                <p className="text-muted-foreground">Criar</p>
                <p className="font-semibold">{jobStatus?.createdAssets || 0}</p>
              </div>
              <div className="rounded border border-border/50 p-3">
                <p className="text-muted-foreground">Atualizar</p>
                <p className="font-semibold">{jobStatus?.updatedAssets || 0}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Pendencias</CardTitle>
              <CardDescription>Itens aguardando aprovacao manual.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadPending()} disabled={loadingPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loadingPending ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Similaridade</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingActions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nenhuma pendencia encontrada.
                    </TableCell>
                  </TableRow>
                )}
                {pendingActions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell>
                      <Badge variant={action.status === "pending" ? "secondary" : action.status === "approved" ? "default" : "destructive"}>
                        {action.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{action.action}</TableCell>
                    <TableCell className="font-medium">{action.deviceName}</TableCell>
                    <TableCell>{action.deviceIp || "-"}</TableCell>
                    <TableCell>{action.tenantName || "-"}</TableCell>
                    <TableCell>{action.matchScore ? `${Math.round(action.matchScore * 100)}%` : "-"}</TableCell>
                    <TableCell>
                      {action.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleDecision(action.id, "approve")} className="gap-1">
                            <CheckCircle className="h-4 w-4" /> Aprovar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDecision(action.id, "reject")} className="gap-1">
                            <XCircle className="h-4 w-4" /> Rejeitar
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default JumpserverSync;
