import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FileJson, Save, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useDevices } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/utils";
import { api } from "@/lib/api";

const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

function Configurations() {
  const { toast } = useToast();
  const { devices } = useDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [interfacesJson, setInterfacesJson] = useState(
    JSON.stringify({}, null, 2)
  );
  const [peersJson, setPeersJson] = useState(
    JSON.stringify({}, null, 2)
  );

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
      const url = `/api/snmp/interfaces?ip=${encodeURIComponent(device.ipAddress)}&community=${encodeURIComponent(device.snmpCommunity)}&port=${encodeURIComponent(device.snmpPort || 161)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const json = await res.json() as { interfaces?: Array<{ index: string; name: string; desc: string; type: number }> };
      if (!json?.interfaces || !Array.isArray(json.interfaces)) {
        throw new Error("Resposta inesperada do gateway SNMP (sem 'interfaces')");
      }
      const group = device.name.split("-")[0] || "Borda";
      const file = {
        [group]: json.interfaces.map(it => ({
          desc_value: it.desc || "",
          indice: String(it.index),
          name_value: it.name || "",
          type: Number(it.type || 0),
        })),
      };
      // Primeiro atualiza a visualização de JSON para o usuário
      setInterfacesJson(JSON.stringify(file, null, 2));
      if (API_MODE) {
        try {
          await api.saveDiscoveredInterfaces(selectedDeviceId!, (json.interfaces || []).map((it) => ({
            index: it.index,
            name: it.name,
            desc: it.desc,
            type: it.type,
          })));
        } catch (e) {
          console.error("Erro ao salvar interfaces no backend:", e);
          toast({ title: "Aviso", description: "Falha ao salvar interfaces no backend. Dados exibidos apenas na sessão.", variant: "destructive" });
        }
      } else {
        try {
          db.saveInterfacesFile(selectedDeviceId, file);
        } catch (e) {
          console.error("Erro ao salvar interfaces no storage:", e);
          toast({ title: "Aviso", description: "Falha ao salvar interfaces no storage local. Dados exibidos apenas na sessão.", variant: "destructive" });
        }
      }
      toast({ title: "Interfaces descobertas", description: `Coletadas ${json.interfaces.length} interfaces e salvas com sucesso.` });
    } catch (err: any) {
      console.error("Descoberta de interfaces falhou:", err);
      toast({ title: "Falha no SNMP", description: String(err?.message || "Verifique o gateway SNMP e conectividade."), variant: "destructive" });
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
      const url = `/api/snmp/bgp-peers?ip=${encodeURIComponent(device.ipAddress)}&community=${encodeURIComponent(device.snmpCommunity)}&port=${encodeURIComponent(device.snmpPort || 161)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const json = await res.json() as { localAsn?: number; peers?: Array<{ ip: string; asn: number; name?: string }> };
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
      // Primeiro atualiza a visualização de JSON para o usuário
      setPeersJson(JSON.stringify(file, null, 2));
      if (API_MODE) {
        try {
          await api.saveDiscoveredPeers(selectedDeviceId!, (json.peers || []).map((p) => ({
            ip: p.ip,
            asn: p.asn,
            name: p.name,
            vrf_name: "DEFAULT",
          })), json.localAsn);
        } catch (e) {
          console.error("Erro ao salvar peers no backend:", e);
          toast({ title: "Aviso", description: "Falha ao salvar peers no backend. Dados exibidos apenas na sessão.", variant: "destructive" });
        }
      } else {
        try {
          db.savePeersFile(selectedDeviceId, file);
        } catch (e) {
          console.error("Erro ao salvar peers no storage:", e);
          toast({ title: "Aviso", description: "Falha ao salvar peers no storage local. Dados exibidos apenas na sessão.", variant: "destructive" });
        }
      }
      toast({ title: "Peers descobertos", description: `Coletados ${json.peers.length} peers e salvos com sucesso.` });
    } catch (err: any) {
      console.error("Descoberta de peers falhou:", err);
      toast({ title: "Falha no SNMP", description: String(err?.message || "Verifique o gateway SNMP e conectividade."), variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
          <p className="text-muted-foreground mt-2">Edite os arquivos de configuração JSON</p>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">Dispositivo para descoberta:</span>
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
                  <Button variant="outline" onClick={handleDiscoverInterfaces}>Descobrir Interfaces</Button>
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
                  <Button variant="outline" onClick={handleDiscoverPeers}>Descobrir Peer</Button>
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
