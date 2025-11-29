import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileJson, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { db, Device } from "@/lib/utils";
import { api } from "@/lib/api";
import { waitForJobCompletion } from "@/queues/job-client";

const API_MODE = import.meta.env.VITE_USE_BACKEND === "true";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device | null;
};

export function DeviceConfigDialog({ open, onOpenChange, device }: Props) {
  const { toast } = useToast();
  const [interfacesJson, setInterfacesJson] = useState(JSON.stringify({}, null, 2));
  const [peersJson, setPeersJson] = useState(JSON.stringify({}, null, 2));
  const [interfacesJobRunning, setInterfacesJobRunning] = useState(false);
  const [peersJobRunning, setPeersJobRunning] = useState(false);

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
      if (!device) return;
      try {
        if (API_MODE) {
          const group = device.name?.split("-")[0] || "Borda";
          const rows = await api.getDiscoveredInterfaces(device.id);
          const ifacesFile = {
            [group]: (rows as any[]).map((r) => ({
              desc_value: String(r.ifDesc || ""),
              indice: String(r.ifIndex || ""),
              name_value: String(r.ifName || ""),
              type: Number(r.ifType || 0),
            })),
          };
          setInterfacesJson(JSON.stringify(ifacesFile || {}, null, 2));
          const peersRows = await api.getDiscoveredPeers(device.id);
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
        }
      } catch (e) {
        console.warn("Falha ao carregar descobertas do backend, usando localStorage:", e);
      }
      const ifaces = db.getInterfacesFile(String(device.id));
      const peers = db.getPeersFile(String(device.id));
      setInterfacesJson(JSON.stringify(ifaces || {}, null, 2));
      setPeersJson(JSON.stringify(peers || {}, null, 2));
    };
    if (open && device) run();
  }, [device, open]);

  const handleDiscoverInterfaces = async () => {
    if (!device) return;
    if (!device.ipAddress || !device.snmpCommunity) {
      toast({ title: "Dados SNMP ausentes", description: "Preencha IP e SNMP community no cadastro do dispositivo.", variant: "destructive" });
      return;
    }
    try {
      if (!API_MODE) {
        toast({ title: "Modo offline", description: "Ative VITE_USE_BACKEND para usar as filas SNMP.", variant: "destructive" });
        return;
      }
      setInterfacesJobRunning(true);
      const job = await api.startDiscoveryJob(device.id, 'interfaces') as { jobId: string };
      toast({ title: "Descoberta enfileirada", description: "O gateway SNMP está coletando as interfaces." });
      await waitForJobCompletion('snmp-discovery', job.jobId);
      const rows = await api.getDiscoveredInterfaces(device.id);
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
    if (!device) return;
    if (!device.ipAddress || !device.snmpCommunity) {
      toast({ title: "Dados SNMP ausentes", description: "Preencha IP e SNMP community no cadastro do dispositivo.", variant: "destructive" });
      return;
    }
    try {
      if (!API_MODE) {
        toast({ title: "Modo offline", description: "Ative o backend para executar descobertas.", variant: "destructive" });
        return;
      }
      setPeersJobRunning(true);
      const job = await api.startDiscoveryJob(device.id, 'peers') as { jobId: string };
      toast({ title: "Descoberta enfileirada", description: "O gateway SNMP está coletando os peers BGP." });
      await waitForJobCompletion('snmp-discovery', job.jobId);
      const rows = await api.getDiscoveredPeers(device.id);
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

  if (!device) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurações — {device.name}</DialogTitle>
          <DialogDescription>Interfaces e peers descobertos para o dispositivo selecionado.</DialogDescription>
        </DialogHeader>

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
                    <p className="text-sm text-muted-foreground">Configuração das interfaces do dispositivo</p>
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
                    <p className="text-sm text-muted-foreground">Peers BGP descobertos para o dispositivo</p>
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
                      "Descobrir Peers"
                    )}
                  </Button>
                </div>
                <div className="overflow-auto rounded border border-border/50">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2">IP Peer</th>
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
