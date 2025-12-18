import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, RefreshCw, PlusCircle, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, UserCheck } from "lucide-react";


const OperationalHub = () => {
    const [auditData, setAuditData] = useState<any>(null);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [syncReport, setSyncReport] = useState<any>(null);
    const [loadingSync, setLoadingSync] = useState(false);
    const [selectedSync, setSelectedSync] = useState<string[]>([]);
    const [executingSync, setExecutingSync] = useState(false);


    const fetchAudit = async () => {
        setLoadingAudit(true);
        try {
            const data = await api.hub.getAuditJumpserver();
            setAuditData(data);
        } catch (error: any) {
            toast.error("Falha ao carregar auditoria: " + error.message);
        } finally {
            setLoadingAudit(false);
        }
    };

    const fetchSyncReport = async () => {
        setLoadingSync(true);
        try {
            const data = await api.hub.getMovideskSyncReport();
            setSyncReport(data);
            setSelectedSync([]);
        } catch (error: any) {
            toast.error("Falha ao carregar relatório Movidesk: " + error.message);
        } finally {
            setLoadingSync(false);
        }
    };

    const handleApproveSync = async () => {
        if (selectedSync.length === 0) return;
        setExecutingSync(true);
        try {
            const res = await api.hub.approveMovideskSync(selectedSync);
            const results = res.results || [];
            const success = results.filter((r: any) => r.status === 'success').length;
            const warning = results.filter((r: any) => r.status === 'warning').length;
            const error = results.filter((r: any) => r.status === 'error').length;

            if (warning > 0 || error > 0) {
                toast.info(`Processamento concluído: ${success} OK, ${warning} Conflitos, ${error} Erros.`);
            } else {
                toast.success(`${success} ações executadas com sucesso.`);
            }
            fetchSyncReport();
        } catch (error: any) {
            toast.error("Erro ao processar aprovação: " + error.message);
        } finally {
            setExecutingSync(false);
        }
    };

    const toggleSelection = (id: string) => {
        setSelectedSync(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };


    useEffect(() => {
        fetchAudit();
    }, []);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">HUB Operacional</h1>
                        <p className="text-muted-foreground">
                            Central de operações e integridade de dados (FastAPI Powered).
                        </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] animate-pulse">HUB_DEBUG_V1</Badge>
                </div>

                {loadingAudit && !auditData && (
                    <div className="flex items-center gap-2 p-4 bg-blue-500/10 text-blue-500 rounded-lg text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando dados da auditoria...
                    </div>
                )}

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">NetBox Devices</CardTitle>
                            <Search className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{auditData?.summary?.netbox_devices_analyzed || "..."}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Em Conformidade (JS)</CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {auditData?.summary ? (auditData.summary.netbox_devices_analyzed || 0) - (auditData.summary.missing_count || 0) : "..."}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Inconsistências (JS)</CardTitle>
                            <AlertCircle className="h-4 w-4 text-destructive" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-destructive">
                                {auditData?.summary?.missing_count ?? "0"}
                            </div>
                        </CardContent>
                    </Card>

                </div>

                <Tabs defaultValue="audit" className="w-full">
                    <TabsList className="mb-4">
                        <TabsTrigger value="audit" onClick={fetchAudit} className="gap-2">
                            <ShieldCheck className="h-4 w-4" /> Sanity Check
                        </TabsTrigger>
                        <TabsTrigger value="movidesk" onClick={fetchSyncReport} className="gap-2">
                            <UserCheck className="h-4 w-4" /> Sincronização Movidesk
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="audit">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle>Netbox vs JumpServer</CardTitle>
                                    <CardDescription>
                                        Dispositivos documentados no Netbox mas ausentes no JumpServer.
                                    </CardDescription>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={fetchAudit}
                                    disabled={loadingAudit}
                                    className="gap-2"
                                >
                                    <RefreshCw className={`h-4 w-4 ${loadingAudit ? 'animate-spin' : ''}`} />
                                    Atualizar
                                </Button>
                            </CardHeader>
                            <CardContent>
                                {auditData?.missing_devices?.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Nome</TableHead>
                                                <TableHead>IP Primary</TableHead>
                                                <TableHead>Site</TableHead>
                                                <TableHead>Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {auditData?.missing_devices?.map((device: any) => (
                                                <TableRow key={device.id}>
                                                    <TableCell className="font-medium text-xs lg:text-sm">{device.name}</TableCell>
                                                    <TableCell className="text-xs lg:text-sm">{device.ip}</TableCell>
                                                    <TableCell className="text-xs lg:text-sm">{device.site}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="destructive" className="text-[10px] lg:text-xs">Missing JS</Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 text-center">
                                        <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                                        <h3 className="text-lg font-semibold">Tudo em ordem!</h3>
                                        <p className="text-muted-foreground">Todos os dispositivos do Netbox possuem acesso configurado no JumpServer.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="movidesk">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle>Pendências Movidesk</CardTitle>
                                    <CardDescription>
                                        Clientes/Empresas do Movidesk pendentes de sincronização ou atualização.
                                    </CardDescription>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={fetchSyncReport}
                                        disabled={loadingSync}
                                        className="gap-2"
                                    >
                                        <RefreshCw className={`h-4 w-4 ${loadingSync ? 'animate-spin' : ''}`} />
                                        Scan
                                    </Button>
                                    {selectedSync.length > 0 && (
                                        <Button
                                            size="sm"
                                            onClick={handleApproveSync}
                                            disabled={executingSync}
                                            className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                                        >
                                            {executingSync ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                            Autorizar {selectedSync.length} Ações
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {loadingSync ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Loader2 className="h-12 w-12 text-blue-500 animate-spin mb-4" />
                                        <p className="text-muted-foreground animate-pulse">Comparando Movidesk com Sistemas Locais...</p>
                                    </div>
                                ) : syncReport?.actions?.length > 0 ? (
                                    <div className="space-y-4">
                                        <div className="flex gap-4 text-xs">
                                            <div className="flex items-center gap-1">
                                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                                                    {syncReport.actions.filter((a: any) => a.status === 'synced').length} Sincronizados
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">
                                                    {syncReport.actions.filter((a: any) => a.status !== 'synced').length} Pendentes
                                                </Badge>
                                            </div>
                                        </div>

                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[50px]">
                                                        <Checkbox
                                                            checked={selectedSync.length > 0 && selectedSync.length === syncReport.actions.filter((a: any) => a.status !== 'synced').length}
                                                            onCheckedChange={(checked) => {
                                                                if (checked) setSelectedSync(syncReport.actions.filter((a: any) => a.status !== 'synced').map((a: any) => a.id));
                                                                else setSelectedSync([]);
                                                            }}
                                                        />
                                                    </TableHead>
                                                    <TableHead>Cliente (Movidesk)</TableHead>
                                                    <TableHead>CNPJ</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead>Detalhes</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {syncReport.actions.map((action: any) => (
                                                    <TableRow key={action.id} className={action.status === 'synced' ? 'opacity-60 bg-muted/30' : ''}>
                                                        <TableCell>
                                                            {action.status !== 'synced' && (
                                                                <Checkbox
                                                                    checked={selectedSync.includes(action.id)}
                                                                    onCheckedChange={() => toggleSelection(action.id)}
                                                                />
                                                            )}
                                                            {action.status === 'synced' && (
                                                                <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="font-medium text-xs lg:text-sm">
                                                            {action.client_name}
                                                            <p className="text-[10px] text-muted-foreground">ID: {action.movidesk_id}</p>
                                                        </TableCell>
                                                        <TableCell className="text-xs lg:text-sm">{action.cnpj}</TableCell>
                                                        <TableCell>
                                                            {action.status === 'synced' ? (
                                                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200 text-[10px]">OK</Badge>
                                                            ) : action.status === 'pending_create' ? (
                                                                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200 text-[10px]">Novo</Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200 text-[10px]">Update</Badge>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-xs text-muted-foreground italic">
                                                            {action.details}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 text-center">
                                        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                                        <h3 className="text-lg font-semibold">Nenhum dado</h3>
                                        <p className="text-muted-foreground">Clique em Scan para buscar empresas no Movidesk.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

            </div>
        </DashboardLayout>
    );
};

export default OperationalHub;
