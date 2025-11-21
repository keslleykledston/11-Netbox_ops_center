import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { LogViewer } from "@/components/LogViewer";
import { useServiceHealth } from "@/hooks/use-service-health";
import { Activity, Database, Server, Network, Layers, FileText } from "lucide-react";

const Maintenance = () => {
  const { health } = useServiceHealth();
  const [summary, setSummary] = useState<{ devices: number; interfaces: number; peers: number; applications: number; tenants: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [opts, setOpts] = useState({ devices: false, discoveries: false, applications: false, tenants: false, global: false });
  const [importData, setImportData] = useState<any | null>(null);
  const [importOpts, setImportOpts] = useState({ importTenants: true, importDevices: true, importApplications: true, importDiscoveries: true, overwriteTenants: false, overwriteDevices: false, overwriteApplications: false, overwriteDiscoveries: false });
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [purgePreview, setPurgePreview] = useState<any | null>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [asnList, setAsnList] = useState<Array<{ id: number; asn: number; name: string }>>([]);
  const [asnEdit, setAsnEdit] = useState<Record<number, string>>({});
  const [newAsn, setNewAsn] = useState("");
  const [newAsnName, setNewAsnName] = useState("");
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const load = async () => {
    try {
      const s = await api.adminSummary();
      setSummary(s as any);
    } catch (e) {
      setSummary(null);
    }
    try {
      const reg = await api.listAsnRegistry();
      if (Array.isArray(reg)) {
        setAsnList(reg.map((r: any) => ({ id: r.id, asn: r.asn, name: r.name })));
      }
      setAsnEdit({});
    } catch (e) {
      console.error("Failed to load ASN registry:", e);
    }
  };
  useEffect(() => { console.log("Maintenance mounted"); load(); }, []);

  const loadAudit = async () => {
    try {
      const params: any = {};
      if (auditAction) params.action = auditAction;
      if (auditFrom) params.from = auditFrom;
      if (auditTo) params.to = auditTo;
      params.limit = 50;
      const rows = await api.adminAuditList(params);
      setAudit(rows as any);
    } catch {
      setAudit([]);
    }
  };

  const downloadSnapshot = async () => {
    try {
      const data = await api.adminSnapshot();
      const text = JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `snapshot-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  };

  const purge = async () => {
    if (confirm.toUpperCase() !== "APAGAR") {
      alert("Digite APAGAR para confirmar.");
      return;
    }
    setLoading(true);
    try {
      await api.adminPurge({ ...opts, confirm });
      await load();
      setConfirm("");
      alert("Concluído");
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const previewPurge = async () => {
    setLoading(true);
    try {
      const res = await api.adminPurge({ ...opts, confirm: "APAGAR", dryRun: true });
      setPurgePreview(res);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const onSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const json = JSON.parse(text);
      setImportData(json);
      alert("Snapshot carregado. Revise as opções e clique Importar.");
    } catch {
      alert("Arquivo inválido");
    }
  };

  const doImport = async () => {
    if (!importData) {
      alert("Nenhum snapshot carregado");
      return;
    }
    if (!window.confirm("Tem certeza que deseja importar? A operação pode sobrescrever dados conforme opções.")) return;
    setLoading(true);
    try {
      await api.adminImportSnapshot(importData, importOpts as any);
      await load();
      alert("Importação concluída");
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const dryRunImport = async () => {
    if (!importData) {
      alert("Nenhum snapshot carregado");
      return;
    }
    setLoading(true);
    try {
      const res = await api.adminImportSnapshot(importData, { ...importOpts, dryRun: true } as any);
      setDryRunResult(res);
      alert(`Dry-run: Tenants=${res.tenants || 0}, Devices=${res.devices || 0}, Applications=${res.applications || 0}, Interfaces=${res.interfaces || 0}, Peers=${res.peers || 0}`);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Manutenção</h1>
            <p className="text-muted-foreground mt-2">Ferramentas administrativas de manutenção (escopo do seu tenant). Ações críticas exigem confirmação.</p>
          </div>
          <Button
            onClick={() => setLogViewerOpen(true)}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            Logs
          </Button>
        </div>

        <LogViewer open={logViewerOpen} onOpenChange={setLogViewerOpen} />

        {/* Service Health Dashboard */}
        {health ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="bg-card/50">
              <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Server className="h-4 w-4" /> API
                </div>
                <div className={`text-lg font-bold ${health.services?.api?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                  {health.services?.api?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground">Porta {health.services?.api?.port}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50">
              <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Network className="h-4 w-4" /> SNMP
                </div>
                <div className={`text-lg font-bold ${health.services?.snmp?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                  {health.services?.snmp?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground">Porta {health.services?.snmp?.port}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50">
              <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Database className="h-4 w-4" /> Redis
                </div>
                <div className={`text-lg font-bold ${health.services?.redis?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                  {health.services?.redis?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground">Porta {health.services?.redis?.port}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50">
              <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Database className="h-4 w-4" /> Database
                </div>
                <div className={`text-lg font-bold ${health.services?.database?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                  {health.services?.database?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground">Prisma</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50">
              <CardContent className="p-4 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Layers className="h-4 w-4" /> Queues
                </div>
                <div className={`text-lg font-bold ${health.services?.queues?.status === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                  {health.services?.queues?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground">{health.services?.queues?.workers} Workers</div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="text-center p-4 text-muted-foreground">Carregando status dos serviços...</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumo (Tenant)</CardTitle>
              <CardDescription>Contadores atuais</CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <ul className="space-y-1 text-sm">
                  <li>Dispositivos: {summary.devices}</li>
                  <li>Descobertas - Interfaces: {summary.interfaces}</li>
                  <li>Descobertas - Peers: {summary.peers}</li>
                  <li>Aplicações: {summary.applications}</li>
                  <li>Tenants (visível): {summary.tenants}</li>
                </ul>
              ) : (
                <p className="text-muted-foreground">Sem dados (verifique autenticação)</p>
              )}
              <div className="mt-4">
                <Button variant="outline" onClick={downloadSnapshot}>Baixar snapshot (JSON)</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Zona de Perigo</CardTitle>
              <CardDescription>Selecione o que deseja remover no seu escopo. Digite APAGAR para confirmar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm"><input className="accent-zinc-600" type="checkbox" checked={opts.devices} onChange={(e) => setOpts({ ...opts, devices: e.target.checked })} /> Dispositivos</label>
                <label className="flex items-center gap-2 text-sm"><input className="accent-zinc-600" type="checkbox" checked={opts.discoveries} onChange={(e) => setOpts({ ...opts, discoveries: e.target.checked })} /> Descobertas (Interfaces e Peers)</label>
                <label className="flex items-center gap-2 text-sm"><input className="accent-zinc-600" type="checkbox" checked={opts.applications} onChange={(e) => setOpts({ ...opts, applications: e.target.checked })} /> Aplicações</label>
                <label className="flex items-center gap-2 text-sm"><input className="accent-zinc-600" type="checkbox" checked={opts.tenants} onChange={(e) => setOpts({ ...opts, tenants: e.target.checked })} /> Tenants (Admin global)</label>
                <label className="flex items-center gap-2 text-sm"><input className="accent-zinc-600" type="checkbox" checked={opts.global} onChange={(e) => setOpts({ ...opts, global: e.target.checked })} /> Global (Admin)</label>
              </div>
              <div className="flex items-center gap-2">
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Digite APAGAR" className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400 max-w-xs" />
                <Button variant="outline" onClick={previewPurge} disabled={loading}>Prévia</Button>
                <Button variant="destructive" onClick={purge} disabled={loading}>Executar</Button>
              </div>
              {purgePreview && (
                <div className="text-xs text-muted-foreground">
                  <p>Prévia de remoção: Devices {purgePreview.deletedDevices || 0}, Interfaces {purgePreview.deletedInterfaces || 0}, Peers {purgePreview.deletedPeers || 0}, Applications {purgePreview.deletedApplications || 0}{opts.tenants ? `, Tenants ${purgePreview.deletedTenants || 0}` : ''}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">A remoção é irreversível. Em produção, recomenda-se usar backups e executar estas ações com usuário admin.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Importar Snapshot (Admin)</CardTitle>
              <CardDescription>Restaure dados a partir de um arquivo JSON exportado. Você pode optar por mesclar ou sobrescrever por entidade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input type="file" accept="application/json" onChange={onSelectFile} className="bg-zinc-800 text-white border-zinc-700 file:text-white file:bg-zinc-700 file:border-0" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.importTenants} onChange={(e) => setImportOpts({ ...importOpts, importTenants: e.target.checked })} /> Importar Tenants</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.overwriteTenants} onChange={(e) => setImportOpts({ ...importOpts, overwriteTenants: e.target.checked })} /> Sobrescrever Tenants</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.importDevices} onChange={(e) => setImportOpts({ ...importOpts, importDevices: e.target.checked })} /> Importar Dispositivos</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.overwriteDevices} onChange={(e) => setImportOpts({ ...importOpts, overwriteDevices: e.target.checked })} /> Sobrescrever Dispositivos</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.importApplications} onChange={(e) => setImportOpts({ ...importOpts, importApplications: e.target.checked })} /> Importar Aplicações</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.overwriteApplications} onChange={(e) => setImportOpts({ ...importOpts, overwriteApplications: e.target.checked })} /> Sobrescrever Aplicações</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.importDiscoveries} onChange={(e) => setImportOpts({ ...importOpts, importDiscoveries: e.target.checked })} /> Importar Descobertas</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importOpts.overwriteDiscoveries} onChange={(e) => setImportOpts({ ...importOpts, overwriteDiscoveries: e.target.checked })} /> Sobrescrever Descobertas</label>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={dryRunImport} disabled={loading || !importData}>Dry‑run</Button>
                <Button onClick={doImport} disabled={loading || !importData}>Importar</Button>
              </div>
              {dryRunResult && (
                <div className="text-xs text-muted-foreground">
                  <p>Prévia: Tenants {dryRunResult.tenants || 0}, Devices {dryRunResult.devices || 0}, Applications {dryRunResult.applications || 0}, Interfaces {dryRunResult.interfaces || 0}, Peers {dryRunResult.peers || 0}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Importação exige permissão de admin. Tenha certeza das opções de sobrescrita antes de continuar.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ASN Registry</CardTitle>
              <CardDescription>Liste e edite nomes de ASNs. Reprocessa a partir dos peers descobertos quando necessário.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-center">
                <Input placeholder="ASN" value={newAsn} onChange={(e) => setNewAsn(e.target.value)} className="w-[140px] bg-zinc-800 text-white border-zinc-700" />
                <Input placeholder="Nome do ASN" value={newAsnName} onChange={(e) => setNewAsnName(e.target.value)} className="bg-zinc-800 text-white border-zinc-700" />
                <Button onClick={async () => { try { await api.upsertAsnRegistry(Number(newAsn), newAsnName); setNewAsn(""); setNewAsnName(""); await load(); } catch (e: any) { alert(String(e?.message || e)); } }}>Adicionar/Atualizar</Button>
                <Button variant="outline" onClick={async () => { try { await api.reprocessAsnRegistry(); await load(); alert('Reprocessamento concluído'); } catch (e: any) { alert(String(e?.message || e)); } }}>Reprocessar ASNs</Button>
              </div>
              <div className="overflow-auto border rounded">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2">ASN</th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asnList.map((r) => (
                      <tr key={r.id} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-mono text-xs">AS{r.asn}</td>
                        <td className="px-3 py-1.5">
                          <Input value={asnEdit[r.id] ?? r.name} onChange={(e) => setAsnEdit((prev) => ({ ...prev, [r.id]: e.target.value }))} className="bg-zinc-800 text-white border-zinc-700" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Button variant="outline" size="sm" onClick={async () => { const name = asnEdit[r.id] ?? r.name; try { await api.upsertAsnRegistry(r.asn, name); await load(); } catch (e: any) { alert(String(e?.message || e)); } }}>Salvar</Button>
                        </td>
                      </tr>
                    ))}
                    {asnList.length === 0 && (
                      <tr><td className="px-3 py-3 text-muted-foreground" colSpan={3}>Nenhum ASN cadastrado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auditoria</CardTitle>
              <CardDescription>Últimos eventos (até 50). Filtre por ação ou período.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input placeholder="Ação (ex: purge, import)" value={auditAction} onChange={(e) => setAuditAction(e.target.value)} className="bg-zinc-800 text-white border-zinc-700 placeholder:text-zinc-400" />
                <Input type="datetime-local" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} className="bg-zinc-800 text-white border-zinc-700" />
                <Input type="datetime-local" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} className="bg-zinc-800 text-white border-zinc-700" />
                <Button variant="outline" onClick={loadAudit}>Buscar</Button>
              </div>
              <div className="overflow-auto border rounded">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1">Data</th>
                      <th className="text-left px-2 py-1">Ação</th>
                      <th className="text-left px-2 py-1">Usuário</th>
                      <th className="text-left px-2 py-1">Role</th>
                      <th className="text-left px-2 py-1">Tenant</th>
                      <th className="text-left px-2 py-1">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((row: any) => (
                      <tr key={row.id} className="border-t border-border/40">
                        <td className="px-2 py-1">{new Date(row.createdAt).toLocaleString()}</td>
                        <td className="px-2 py-1">{row.action}</td>
                        <td className="px-2 py-1">{row.userId || ''}</td>
                        <td className="px-2 py-1">{row.userRole || ''}</td>
                        <td className="px-2 py-1">{row.tenantId || ''}</td>
                        <td className="px-2 py-1 max-w-[360px] truncate" title={row.details || ''}>{row.details || ''}</td>
                      </tr>
                    ))}
                    {audit.length === 0 && (
                      <tr><td className="px-2 py-2 text-muted-foreground" colSpan={6}>Sem eventos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Maintenance;
