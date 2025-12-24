import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FileJson, Save, X, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useApplications, useDevices } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/utils";
import { api } from "@/lib/api";
import { waitForJobCompletion } from "@/queues/job-client";
import { useTenantContext } from "@/contexts/TenantContext";

const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

function Configurations() {
  const { toast } = useToast();
  const { selectedTenantId, loading: tenantLoading } = useTenantContext();
  const { devices } = useDevices(selectedTenantId || undefined);
  const { applications, updateApplication } = useApplications(selectedTenantId || undefined);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [rsaKey, setRsaKey] = useState("");
  const [savingRsaKey, setSavingRsaKey] = useState(false);
  const [interfacesJson, setInterfacesJson] = useState(
    JSON.stringify({}, null, 2)
  );
  const [peersJson, setPeersJson] = useState(
    JSON.stringify({}, null, 2)
  );
  const [interfacesJobRunning, setInterfacesJobRunning] = useState(false);
  const [peersJobRunning, setPeersJobRunning] = useState(false);

  // Helpers para montar linhas tabuladas a partir do JSON em memória
  const parseInterfacesRows = () => {
    try {
      const data = JSON.parse(interfacesJson || "{}") as Record<string, Array<{ desc_value: string; indice: string; name_value: string; type: number }>>;
      const firstGroup = Object.keys(data)[0];
      const rows = firstGroup ? data[firstGroup] || [] : [];
      return rows.map((r) => ({ index: r.indice, name: r.name_value, desc: r.desc_value, type: r.type }));
    } catch {
      return [];
    }
  };
  const parsePeersRows = () => {
    try {
      const data = JSON.parse(peersJson || "{}") as Record<string, Array<{ asn: string; ip_peer: string; name: string; type: number; vrf_name: string }>>;
      const firstGroup = Object.keys(data)[0];
      const rows = firstGroup ? data[firstGroup] || [] : [];
      return rows.map((p) => ({ ip: p.ip_peer, asn: p.asn, name: p.name, vrf: p.vrf_name }));
    } catch {
      return [];
    }
  };

  useEffect(() => {
    const run = async () => {
      if (!selectedDeviceId) {
        if (devices.length > 0) setSelectedDeviceId(devices[0].id);
        return;
      }
      if (API_MODE) {
        try {
          const device = devices.find(d => d.id === selectedDeviceId);
          const group = device?.name?.split("-")[0] || "Borda";
          const rows = await api.getDiscoveredInterfaces(selectedDeviceId);
          const file = {
            [group]: (rows as any[]).map((r) => ({
              desc_value: String(r.ifDesc || ""),
              indice: String(r.ifIndex || ""),
              name_value: String(r.ifName || ""),
              type: Number(r.ifType || 0),
            })),
          };
          setInterfacesJson(JSON.stringify(file || {}, null, 2));
          const peersRows = await api.getDiscoveredPeers(selectedDeviceId);
          const peersFile = {
            [group]: (peersRows as any[]).map((p) => ({
              asn: String(p.asn || ""),
              ip_peer: String(p.ipPeer || ""),
              name: String(p.name || "Peer"),
              type: 0,
              vrf_name: String(p.vrfName || "DEFAULT"),
            })),
          };
          setPeersJson(JSON.stringify(peersFile || {}, null, 2));
          return;
        } catch (e) {
          // fallback local
          console.warn("Falha ao carregar descobertas do backend, usando localStorage:", e);
        }
      }
      const ifaces = db.getInterfacesFile(selectedDeviceId);
      const peers = db.getPeersFile(selectedDeviceId);
      setInterfacesJson(JSON.stringify(ifaces || {}, null, 2));
      setPeersJson(JSON.stringify(peers || {}, null, 2));
    };
    run();
  }, [selectedDeviceId, devices]);

  // Reset seleção ao trocar tenant ou lista
  useEffect(() => {
    if (devices.length === 0) {
      setSelectedDeviceId(undefined);
    } else if (!selectedDeviceId || !devices.find((d) => d.id === selectedDeviceId)) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId, selectedTenantId]);

  const handleSave = (type: "interfaces" | "peers") => {
    if (!selectedDeviceId) {
      toast({ title: "Selecione um dispositivo", description: "Escolha o dispositivo para salvar os dados.", variant: "destructive" });
      return;
    }
    try {
      if (type === "interfaces") {
        db.saveInterfacesFile(selectedDeviceId, JSON.parse(interfacesJson));
        toast({ title: "Interfaces salvas", description: "interfaces.json atualizado para o dispositivo selecionado." });
      } else {
        db.savePeersFile(selectedDeviceId, JSON.parse(peersJson));
        toast({ title: "Peers salvos", description: "peers.json atualizado para o dispositivo selecionado." });
      }
    } catch {
      toast({ title: "JSON inválido", description: "Corrija o JSON antes de salvar.", variant: "destructive" });
    }
  };

  const handleCancel = () => {
    if (!selectedDeviceId) return;
    const ifaces = db.getInterfacesFile(selectedDeviceId);
    const peers = db.getPeersFile(selectedDeviceId);
    setInterfacesJson(JSON.stringify(ifaces || {}, null, 2));
    setPeersJson(JSON.stringify(peers || {}, null, 2));
  };

  const handleDiscoverInterfaces = async () => {
    if (!selectedDeviceId) {
      toast({ title: "Selecione um dispositivo", description: "Escolha um dispositivo para descobrir interfaces.", variant: "destructive" });
      return;
    }
    const device = devices.find(d => d.id === selectedDeviceId);
    if (!device || !device.ipAddress || !device.snmpCommunity) {
      toast({ title: "Dados SNMP ausentes", description: "Preencha IP e SNMP community no cadastro do dispositivo.", variant: "destructive" });
      return;
    }
    try {
      if (!API_MODE) {
        toast({ title: "Modo offline", description: "Ative VITE_USE_BACKEND para usar as filas SNMP.", variant: "destructive" });
        return;
      }
      setInterfacesJobRunning(true);
      const job = await api.startDiscoveryJob(selectedDeviceId!, 'interfaces') as { jobId: string };
      toast({ title: "Descoberta enfileirada", description: "O gateway SNMP está coletando as interfaces." });
      await waitForJobCompletion('snmp-discovery', job.jobId);
      const rows = await api.getDiscoveredInterfaces(selectedDeviceId!);
      const group = device.name.split("-")[0] || "Borda";
      const file = {
        [group]: (rows as any[]).map((r) => ({
          desc_value: String(r.ifDesc || ""),
          indice: String(r.ifIndex || ""),
          name_value: String(r.ifName || ""),
          type: Number(r.ifType || 0),
        })),
      };
      setInterfacesJson(JSON.stringify(file, null, 2));
      toast({ title: "Interfaces descobertas", description: `Coletadas ${(rows as any[]).length} interfaces e salvas com sucesso.` });
    } catch (err: any) {
      console.error("Descoberta de interfaces falhou:", err);
      toast({ title: "Falha no SNMP", description: String(err?.message || "Verifique o gateway SNMP e conectividade."), variant: "destructive" });
    } finally {
      setInterfacesJobRunning(false);
    }
  };

  const handleDiscoverPeers = async () => {
    if (!selectedDeviceId) {
      toast({ title: "Selecione um dispositivo", description: "Escolha um dispositivo para descobrir peers.", variant: "destructive" });
      return;
    }
    const device = devices.find(d => d.id === selectedDeviceId);
    if (!device || !device.ipAddress || !device.snmpCommunity) {
      toast({ title: "Dados SNMP ausentes", description: "Preencha IP e SNMP community no cadastro do dispositivo.", variant: "destructive" });
      return;
    }
    try {
      if (!API_MODE) {
        toast({ title: "Modo offline", description: "Ative o backend para executar descobertas.", variant: "destructive" });
        return;
      }
      setPeersJobRunning(true);
      const job = await api.startDiscoveryJob(selectedDeviceId!, 'peers') as { jobId: string };
      toast({ title: "Descoberta enfileirada", description: "O gateway SNMP está coletando os peers BGP." });
      await waitForJobCompletion('snmp-discovery', job.jobId);
      const rows = await api.getDiscoveredPeers(selectedDeviceId!);
      const group = device.name.split("-")[0] || "Borda";
      const file = {
        [group]: (rows as any[]).map((p) => ({
          asn: String(p.asn || ""),
          ip_peer: String(p.ipPeer || ""),
          name: String(p.name || "Peer"),
          type: 0,
          vrf_name: String(p.vrfName || "DEFAULT"),
        })),
      };
      setPeersJson(JSON.stringify(file, null, 2));
      toast({ title: "Peers descobertos", description: `Coletados ${(rows as any[]).length} peers e salvos com sucesso.` });
    } catch (err: any) {
      console.error("Descoberta de peers falhou:", err);
      toast({ title: "Falha no SNMP", description: String(err?.message || "Verifique o gateway SNMP e conectividade."), variant: "destructive" });
    } finally {
      setPeersJobRunning(false);
    }
  };

  const saveRsaKey = async () => {
    if (!API_MODE) {
      toast({ title: "Modo offline", description: "Ative o backend para salvar a chave RSA.", variant: "destructive" });
      return;
    }
    if (!rsaKey.trim()) {
      toast({ title: "Chave ausente", description: "Cole a chave RSA privada.", variant: "destructive" });
      return;
    }
    const netboxApp = applications.find((app) => /netbox/i.test(app.name));
    if (!netboxApp) {
      toast({ title: "NetBox não configurado", description: "Cadastre a aplicação NetBox primeiro.", variant: "destructive" });
      return;
    }
    setSavingRsaKey(true);
    try {
      await updateApplication(netboxApp.id, { privateKey: rsaKey } as any);
      setRsaKey("");
      toast({ title: "Chave salva", description: "Chave RSA enviada para o servidor com sucesso." });
    } catch (err: any) {
      toast({ title: "Falha ao salvar", description: String(err?.message || err), variant: "destructive" });
    } finally {
      setSavingRsaKey(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground mt-2">Edite os arquivos de configuração JSON</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>NetBox Secrets</CardTitle>
            <CardDescription>Informe a chave RSA privada para descriptografar credenciais do NetBox.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={rsaKey}
              onChange={(e) => setRsaKey(e.target.value)}
              className="font-mono text-sm min-h-[160px]"
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
            />
            <div className="flex gap-2">
              <Button onClick={saveRsaKey} disabled={savingRsaKey} className="gap-2">
                {savingRsaKey ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvando...
                  </span>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salvar chave RSA
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setRsaKey("")} disabled={savingRsaKey} className="gap-2">
                <X className="h-4 w-4" />
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">Dispositivo para descoberta:</span>
          <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId} disabled={tenantLoading || devices.length === 0}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Selecione o dispositivo" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} • {d.ipAddress}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="interfaces" className="space-y-4">
          <TabsList>
            <TabsTrigger value="interfaces">Interfaces</TabsTrigger>
            <TabsTrigger value="peers">BGP Peers</TabsTrigger>
          </TabsList>

          <TabsContent value="interfaces">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle>interfaces.json</CardTitle>
                    <CardDescription>Configuração das interfaces dos dispositivos</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleDiscoverInterfaces} disabled={interfacesJobRunning}>
                    {interfacesJobRunning ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processando...
                      </span>
                    ) : (
                      "Descobrir Interfaces"
                    )}
                  </Button>
                </div>
                <div className="overflow-auto rounded border border-border/50">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2">Index</th>
                        <th className="text-left px-3 py-2">Nome</th>
                        <th className="text-left px-3 py-2">Descrição</th>
                        <th className="text-left px-3 py-2">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseInterfacesRows().map((r, i) => (
                        <tr key={`${r.index}-${i}`} className="border-t border-border/40">
                          <td className="px-3 py-1.5 font-mono text-xs">{r.index}</td>
                          <td className="px-3 py-1.5">{r.name}</td>
                          <td className="px-3 py-1.5">{r.desc}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{r.type}</td>
                        </tr>
                      ))}
                      {parseInterfacesRows().length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-muted-foreground">Nenhuma interface carregada</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Textarea
                  value={interfacesJson}
                  onChange={(e) => setInterfacesJson(e.target.value)}
                  className="font-mono text-sm min-h-[400px]"
                />
                <div className="flex gap-2">
                  <Button onClick={() => handleSave("interfaces")} className="gap-2">
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={handleCancel} className="gap-2">
                    <X className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="peers">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle>peers.json</CardTitle>
                    <CardDescription>Configuração dos peers BGP dos dispositivos</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleDiscoverPeers} disabled={peersJobRunning}>
                    {peersJobRunning ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processando...
                      </span>
                    ) : (
                      "Descobrir Peer"
                    )}
                  </Button>
                </div>
                <div className="overflow-auto rounded border border-border/50">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2">IP</th>
                        <th className="text-left px-3 py-2">ASN</th>
                        <th className="text-left px-3 py-2">Nome</th>
                        <th className="text-left px-3 py-2">VRF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsePeersRows().map((p, i) => (
                        <tr key={`${p.ip}-${i}`} className="border-t border-border/40">
                          <td className="px-3 py-1.5 font-mono text-xs">{p.ip}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{p.asn}</td>
                          <td className="px-3 py-1.5">{p.name}</td>
                          <td className="px-3 py-1.5">{p.vrf}</td>
                        </tr>
                      ))}
                      {parsePeersRows().length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-muted-foreground">Nenhum peer carregado</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Textarea
                  value={peersJson}
                  onChange={(e) => setPeersJson(e.target.value)}
                  className="font-mono text-sm min-h-[400px]"
                />
                <div className="flex gap-2">
                  <Button onClick={() => handleSave("peers")} className="gap-2">
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                  <Button variant="outline" onClick={handleCancel} className="gap-2">
                    <X className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

export default Configurations;
