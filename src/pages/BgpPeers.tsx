import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, GitBranch, Sparkles, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDevices } from "@/hooks/use-mobile";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { db } from "@/lib/utils";
import { api } from "@/lib/api";

const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

const BgpPeers = () => {
  const [searchPrefix, setSearchPrefix] = useState("");

  const peers = [
    {
      id: 1,
      device: "Borda-SP-01",
      ip: "10.20.0.2",
      asn: "269077",
      name: "VISION TELECOM",
      type: "operadora",
      status: "established",
      vrfName: "MAIN",
    },
    {
      id: 2,
      device: "Borda-SP-01",
      ip: "10.20.0.26",
      asn: "4230",
      name: "EMBRATEL",
      type: "operadora",
      status: "established",
      vrfName: "CDN",
    },
    {
      id: 3,
      device: "Borda-RJ-01",
      ip: "10.30.0.5",
      asn: "52468",
      name: "CLIENTE ABC LTDA",
      type: "cliente",
      status: "established",
      vrfName: "DEFAULT",
    },
  ];

  const handleSearch = () => {
    // TODO: Implement prefix search via SSH
    console.log("Searching for prefix:", searchPrefix);
  };

  const handleUpdateLocalAsn = async () => {
    if (!selectedDeviceId) return toast({ title: 'Selecione um dispositivo', variant: 'destructive' });
    const device = devices.find(d => d.id === selectedDeviceId);
    if (!device || !device.ipAddress || !device.snmpCommunity) {
      toast({ title: 'Dados SNMP ausentes', description: 'Preencha IP e SNMP community no cadastro do dispositivo.', variant: 'destructive' });
      return;
    }
    try {
      const url = `/api/snmp/bgp-peers?ip=${encodeURIComponent(device.ipAddress)}&community=${encodeURIComponent(device.snmpCommunity)}&port=${encodeURIComponent(device.snmpPort || 161)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { localAsn?: number };
      const lasn = Number(json.localAsn || 0) || 0;
      if (!lasn) throw new Error('ASN local não detectado via SNMP');
      await api.updateDeviceLocalAsn(selectedDeviceId!, lasn);
      toast({ title: 'ASN local atualizado', description: `AS${lasn} aplicado aos peers deste dispositivo.` });
      // refresh peers list
      try {
        const rows = await api.listBgpPeers(selectedTenantId);
        setDbPeers((rows as any[]).map((r) => ({ id: Number(r.id), deviceName: r.deviceName, ip: r.ip, asn: Number(r.asn || 0), localAsn: Number(r.localAsn || 0), name: r.name || undefined, vrfName: r.vrfName || undefined })));
      } catch {}
    } catch (e: any) {
      toast({ title: 'Falha ao atualizar ASN local', description: String(e?.message || e), variant: 'destructive' });
    }
  };

  const { toast } = useToast();
  const { devices } = useDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [peersJson, setPeersJson] = useState<string>("{}");
  const [tenants, setTenants] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | undefined>(undefined);
  const [dbPeers, setDbPeers] = useState<Array<{ id: number; deviceName: string; ip: string; asn: number; localAsn?: number; name?: string; vrfName?: string }>>([]);
  const [showIbgp, setShowIbgp] = useState<boolean>(false);
  const [enrichingAsns, setEnrichingAsns] = useState<boolean>(false);

  useEffect(() => {
    // Carrega tenants
    api.listTenants().then((list: any[]) => {
      const mapped = (list || []).map((t: any) => ({ id: Number(t.id), name: String(t.name) }));
      setTenants(mapped);
      if (!selectedTenantId && mapped.length > 0) setSelectedTenantId(String(mapped[0].id));
    }).catch(() => setTenants([]));
  }, []);

  useEffect(() => {
    // Carrega peers descobertos do banco para o tenant selecionado
    (async () => {
      try {
        const rows = await api.listBgpPeers(selectedTenantId);
        setDbPeers((rows as any[]).map((r) => ({ id: Number(r.id), deviceName: r.deviceName, ip: r.ip, asn: Number(r.asn || 0), localAsn: Number(r.localAsn || 0) || undefined, name: r.name || undefined, vrfName: r.vrfName || undefined })));
      } catch {
        setDbPeers([]);
      }
    })();
  }, [selectedTenantId]);
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
          console.warn("Falha ao carregar peers do backend, usando localStorage:", e);
        }
      }
      const peers = db.getPeersFile(selectedDeviceId);
      setPeersJson(JSON.stringify(peers || {}, null, 2));
    };
    run();
  }, [selectedDeviceId, devices]);

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
      const url = `/api/snmp/bgp-peers?ip=${encodeURIComponent(device.ipAddress)}&community=${encodeURIComponent(device.snmpCommunity)}&port=${encodeURIComponent(device.snmpPort || 161)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const json = await res.json() as { peers?: Array<{ ip: string; asn: number; name?: string }> };
      if (!json?.peers || !Array.isArray(json.peers)) {
        throw new Error("Resposta inesperada do gateway SNMP (sem 'peers')");
      }
      const group = device.name.split("-")[0] || "Borda";
      const file = {
        [group]: json.peers.map(p => ({
          asn: String(p.asn || ""),
          ip_peer: p.ip || "",
          name: p.name || "Peer",
          type: 0,
          vrf_name: "DEFAULT",
        })),
      };
      try {
      if (API_MODE) {
        try {
          await api.saveDiscoveredPeers(selectedDeviceId!, (json.peers || []).map((p) => ({
            ip: p.ip,
            asn: p.asn,
            name: p.name,
            vrf_name: "DEFAULT",
          })));
        } catch (e) {
          console.error("Erro ao salvar peers no backend:", e);
          throw new Error("Falha ao salvar peers no backend");
        }
      } else {
        db.savePeersFile(selectedDeviceId, file);
      }
      } catch (e) {
        console.error("Erro ao salvar peers no storage:", e);
        throw new Error("Falha ao salvar peers no storage");
      }
      setPeersJson(JSON.stringify(file, null, 2));
      toast({ title: "Peers descobertos", description: `Coletados ${json.peers.length} peers e salvos com sucesso.` });
    } catch (err: any) {
      console.error("Descoberta de peers falhou:", err);
      toast({ title: "Falha no SNMP", description: String(err?.message || "Verifique o gateway SNMP e conectividade."), variant: "destructive" });
    }
  };

  const handleEnrichAsns = async () => {
    try {
      setEnrichingAsns(true);
      toast({ title: "Enriquecendo ASNs", description: "Consultando BGPView e RDAP para resolver nomes dos ASNs..." });

      // Usar o helper da API que já inclui autenticação
      await api.reprocessAsnRegistry();

      // Recarrega os peers para obter os nomes atualizados
      const rows = await api.listBgpPeers(selectedTenantId);
      setDbPeers((rows as any[]).map((r) => ({
        id: Number(r.id),
        deviceName: r.deviceName,
        ip: r.ip,
        asn: Number(r.asn || 0),
        localAsn: Number(r.localAsn || 0) || undefined,
        name: r.name || undefined,
        vrfName: r.vrfName || undefined
      })));

      toast({
        title: "ASNs enriquecidos com sucesso",
        description: "Os nomes dos ASNs foram atualizados via BGPView e RDAP."
      });
    } catch (err: any) {
      console.error("Erro ao enriquecer ASNs:", err);
      toast({
        title: "Falha ao enriquecer ASNs",
        description: String(err?.message || "Verifique se você está autenticado e tente novamente."),
        variant: "destructive"
      });
    } finally {
      setEnrichingAsns(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Peers BGP</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie e monitore os peerings BGP
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filtro por Tenant</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-[280px]">
              <Select value={selectedTenantId} onValueChange={(v) => setSelectedTenantId(v)}>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle>Peers Descobertos (Banco)</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  {(() => {
                    const total = dbPeers.length;
                    const ebgp = dbPeers.filter((p) => (p.localAsn ? Number(p.localAsn) !== Number(p.asn) : true)).length;
                    const ibgp = total - ebgp;
                    return (
                      <span>
                        Total: {total} • eBGP: {ebgp} • iBGP: {ibgp}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleEnrichAsns}
                disabled={enrichingAsns || dbPeers.length === 0}
                className="ml-4"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {enrichingAsns ? "Enriquecendo..." : "Enriquecer ASNs"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Dispositivo</th>
                    <th className="text-left px-3 py-2">IP Peer</th>
                    <th className="text-left px-3 py-2">ASN Remoto</th>
                    <th className="text-left px-3 py-2">Tipo</th>
                    <th className="text-left px-3 py-2">Nome</th>
                    <th className="text-left px-3 py-2">VRF</th>
                  </tr>
                </thead>
                <tbody>
                  {(dbPeers.filter((p) => showIbgp || !p.localAsn || Number(p.localAsn) !== Number(p.asn))).map((p) => (
                    <tr key={p.id} className="border-t border-border/40">
                      <td className="px-3 py-1.5">{p.deviceName}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{p.ip}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{p.asn}</td>
                      <td className="px-3 py-1.5">
                        {p.localAsn && Number(p.localAsn) === Number(p.asn) ? (
                          <Badge variant="secondary">iBGP</Badge>
                        ) : (
                          <Badge>eBGP</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {p.name ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                              <span className="text-xs">{p.name}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">{p.vrfName || 'DEFAULT'}</td>
                    </tr>
                  ))}
                  {dbPeers.filter((p) => showIbgp || !p.localAsn || Number(p.localAsn) !== Number(p.asn)).length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={6}>Nenhum peer descoberto para o tenant selecionado</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Buscar Prefixo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-center">
              <Input
                placeholder="Ex: 8.8.8.0/24"
                value={searchPrefix}
                onChange={(e) => setSearchPrefix(e.target.value)}
                className="max-w-sm"
              />
              <Button onClick={handleSearch}>
                <Search className="h-4 w-4 mr-2" />
                Buscar
              </Button>
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-zinc-600" checked={showIbgp} onChange={(e) => setShowIbgp(e.target.checked)} /> Mostrar iBGP
              </label>
              <Button variant="outline" onClick={handleUpdateLocalAsn}>Atualizar ASN local</Button>
              <Button variant="outline" onClick={handleDiscoverPeers}>Descobrir Peer</Button>
            </div>
          </CardContent>
        </Card>

        

        
      </div>
    </DashboardLayout>
  );
};

export default BgpPeers;
