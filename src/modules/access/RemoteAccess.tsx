import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDevices } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { api, getToken } from "@/lib/api";
import { Terminal as TerminalIcon, Play, StopCircle, RefreshCw, FileText, Shield } from "lucide-react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

type AuditSession = {
  id: number;
  deviceId: number;
  deviceName: string;
  deviceIp: string;
  status: string;
  startedAt?: string;
  endedAt?: string | null;
  durationMs?: number | null;
  user?: { id: number; email: string; username?: string | null } | null;
  canReplay: boolean;
  jumpserverConnectionMode?: string;
  jumpserverSessionId?: string;
};

type LiveSession = {
  id: number;
  key: string;
  device: {
    id: number;
    name: string;
    ipAddress?: string;
  };
  connectionMode?: 'direct' | 'jumpserver';
};

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function buildWsUrl(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  if (API_BASE.startsWith("http")) {
    const proto = API_BASE.startsWith("https") ? "wss" : "ws";
    return `${API_BASE.replace(/^https?/, proto)}${path}?${qs}`;
  }
  if (typeof window === "undefined") return `${path}?${qs}`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${API_BASE}${path}?${qs}`;
}

const stateBadges: Record<string, { text: string; variant: string }> = {
  pending: { text: "Agendada", variant: "bg-muted text-foreground" },
  connecting: { text: "Conectando", variant: "bg-warning/20 text-warning" },
  active: { text: "Ativa", variant: "bg-success/20 text-success" },
  closed: { text: "Encerrada", variant: "bg-muted text-foreground" },
  error: { text: "Erro", variant: "bg-destructive/20 text-destructive" },
};

const RemoteAccess = () => {
  const initialDeviceId = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const params = new URLSearchParams(window.location.search);
    return params.get("deviceId") || undefined;
  }, []);
  const { toast } = useToast();
  const { devices } = useDevices();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(initialDeviceId);
  const [currentSession, setCurrentSession] = useState<LiveSession | null>(null);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [auditSessions, setAuditSessions] = useState<AuditSession[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [logDialog, setLogDialog] = useState<{ open: boolean; title: string; content: string }>({ open: false, title: "", content: "" });
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const instantiateTerminal = useCallback(() => {
    if (termRef.current || !termContainerRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: "#020617",
        foreground: "#d9e3ff",
      },
      fontSize: 14,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termContainerRef.current);
    fit.fit();
    termRef.current = term;
    fitAddonRef.current = fit;

    term.onData((chunk) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "data", payload: chunk }));
      }
    });
  }, []);

  useEffect(() => {
    instantiateTerminal();
  }, [instantiateTerminal]);

  useEffect(() => {
    const handleResize = () => {
      fitAddonRef.current?.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN && termRef.current) {
        socketRef.current.send(
          JSON.stringify({
            type: "resize",
            rows: termRef.current.rows,
            cols: termRef.current.cols,
          })
        );
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchAuditSessions = useCallback(async () => {
    try {
      setLoadingAudit(true);
      const list = (await api.listAccessSessions(100)) as AuditSession[];
      setAuditSessions(list || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Falha ao listar sessões", description: message, variant: "destructive" });
    } finally {
      setLoadingAudit(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAuditSessions();
    const id = setInterval(fetchAuditSessions, 20000);
    return () => clearInterval(id);
  }, [fetchAuditSessions]);

  const closeSocket = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setCurrentSession(null);
  };

  useEffect(() => {
    return () => {
      closeSocket();
      termRef.current?.dispose();
    };
  }, []);

  const connectWebsocket = (session: LiveSession) => {
    if (!termRef.current) instantiateTerminal();
    closeSocket();
    const token = getToken();
    const wsUrl = buildWsUrl(`/access/sessions/${session.id}/stream`, { key: session.key, token });
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setConnectionState("connecting");

    socket.addEventListener("open", () => {
      setConnectionState("open");
      termRef.current?.writeln("\r\n\u001b[32mSessão estabelecida. Bem-vindo ao terminal seguro.\u001b[0m\r\n");
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "data" && typeof payload.payload === "string") {
          termRef.current?.write(payload.payload);
        }
        if (payload.type === "error") {
          toast({ title: "SSH", description: payload.message || payload.payload || "Erro no túnel SSH", variant: "destructive" });
        }
      } catch {
        termRef.current?.write(event.data);
      }
    });

    socket.addEventListener("close", () => {
      setConnectionState("closed");
      termRef.current?.writeln("\r\n\u001b[33mSessão encerrada\u001b[0m\r\n");
      fetchAuditSessions();
    });

    socket.addEventListener("error", () => {
      setConnectionState("closed");
      toast({ title: "WebSocket", description: "Falha na sessão SSH", variant: "destructive" });
    });
  };

  const startSession = async () => {
    if (!selectedDeviceId) {
      toast({ title: "Selecione um dispositivo", description: "Escolha um alvo para iniciar o terminal.", variant: "destructive" });
      return;
    }
    try {
      setConnectionState("connecting");
      const session = (await api.createAccessSession(Number(selectedDeviceId))) as LiveSession;
      setCurrentSession(session);
      connectWebsocket(session);
      toast({ title: "Sessão criada", description: "Conectando ao dispositivo..." });
    } catch (err: unknown) {
      setConnectionState("idle");
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Falha ao iniciar sessão", description: message, variant: "destructive" });
    }
  };

  const loadSessionLog = async (sessionId: number, deviceName: string) => {
    try {
      const { log } = (await api.getAccessSessionLog(sessionId)) as { log: string };
      setLogDialog({ open: true, title: `Sessão ${deviceName}`, content: log || "Sem registros." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Falha ao carregar log", description: message, variant: "destructive" });
    }
  };

  const connectionBadge = stateBadges[currentSession ? connectionState : "idle"] || { text: "Inativo", variant: "bg-muted text-foreground" };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <TerminalIcon className="h-7 w-7 text-primary" />
            Acesso Remoto & Auditoria
          </h1>
          <p className="text-muted-foreground mt-2">
            Provisione sessões SSH seguras via navegador e consulte o histórico completo para auditoria.
          </p>
        </div>

        <Tabs defaultValue="terminal" className="space-y-4">
          <TabsList>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="audit">Auditoria</TabsTrigger>
          </TabsList>

          <TabsContent value="terminal" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Terminal Web</CardTitle>
                <CardDescription>O backend mantém as credenciais e replica a sessão via WebSocket.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">Dispositivo</p>
                      <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o destino" />
                        </SelectTrigger>
                        <SelectContent>
                          {devices.map((device) => (
                            <SelectItem key={device.id} value={device.id}>
                              {device.name} • {device.ipAddress}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">Estado</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={connectionBadge.variant}>{connectionBadge.text}</Badge>
                        {currentSession?.connectionMode && (
                          <Badge variant="outline" className="text-xs">
                            {currentSession.connectionMode === 'jumpserver' ? '🔒 Jumpserver' : '🔗 Direct'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="gap-2 flex-1" onClick={startSession} disabled={!selectedDeviceId || connectionState === "connecting"}>
                        <Play className="h-4 w-4" />
                        Iniciar sessão
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                          closeSocket();
                          setConnectionState("closed");
                        }}
                        disabled={connectionState !== "open"}
                      >
                        <StopCircle className="h-4 w-4" />
                        Encerrar
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-2" onClick={() => fetchAuditSessions()}>
                      <RefreshCw className="h-4 w-4" />
                      Atualizar histórico
                    </Button>
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" />
                      O Ops Center grava todo o fluxo da sessão e mantém os logs no volume <code className="font-mono text-xs">ssh-sessions</code>.
                    </div>
                  </div>
                  <div className="rounded-lg border bg-black/80 p-2 min-h-[420px]">
                    <div ref={termContainerRef} className="h-[400px] overflow-hidden rounded bg-black" />
                    {connectionState === "idle" && (
                      <p className="text-muted-foreground text-sm mt-2">
                        Nenhuma sessão ativa. Escolha um dispositivo e pressione <strong>Iniciar sessão</strong>.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Auditoria de Sessões</CardTitle>
                  <CardDescription>Rastreie quem acessou cada dispositivo e reproduza o log textual gravado.</CardDescription>
                </div>
                <Button variant="outline" className="gap-2" onClick={() => fetchAuditSessions()} disabled={loadingAudit}>
                  <RefreshCw className={`h-4 w-4 ${loadingAudit ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[520px] pr-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dispositivo</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Início</TableHead>
                        <TableHead>Duração</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditSessions.map((session) => {
                        const badge = stateBadges[session.status] || stateBadges.pending;
                        const duration = session.durationMs ? `${Math.round(session.durationMs / 1000)}s` : "—";
                        const started = session.startedAt ? new Date(session.startedAt).toLocaleString() : "—";
                        return (
                          <TableRow key={session.id}>
                            <TableCell className="font-medium">{session.deviceName}</TableCell>
                            <TableCell>{session.user?.username || session.user?.email || "—"}</TableCell>
                            <TableCell>{started}</TableCell>
                            <TableCell>{duration}</TableCell>
                            <TableCell>
                              <Badge className={badge.variant}>{badge.text}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2"
                                  disabled={!session.canReplay}
                                  onClick={() => loadSessionLog(session.id, session.deviceName)}
                                >
                                  <FileText className="h-4 w-4" />
                                  Log
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {auditSessions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            Nenhuma sessão registrada ainda.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={logDialog.open} onOpenChange={(open) => setLogDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{logDialog.title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] rounded border bg-muted/50">
            <pre className="text-sm p-4 whitespace-pre-wrap">{logDialog.content || "Sem registros."}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default RemoteAccess;
