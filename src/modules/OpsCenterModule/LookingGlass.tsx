/**
 * Componente Looking Glass
 * Arquivo: src/modules/OpsCenterModule/LookingGlass.tsx
 */

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OpsCenterModuleAPI } from "./api";
import { LookingGlassResponse } from "./types";
import { Search, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

interface LookingGlassProps {
    apiInstance: OpsCenterModuleAPI;
}

export const LookingGlass: React.FC<LookingGlassProps> = ({ apiInstance }) => {
    const [resource, setResource] = useState("");
    const [lookBackLimit, setLookBackLimit] = useState(86400); // 24 horas padrão
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<LookingGlassResponse | null>(null);
    const [expandedRRC, setExpandedRRC] = useState<string | null>(null);

    useEffect(() => {
        // Carregar configuração inicial se armazenada
        const config = apiInstance.getConfig();
        if (config.defaultLookBackLimit) {
            setLookBackLimit(config.defaultLookBackLimit);
        }
    }, [apiInstance]);

    const handleQuery = async () => {
        if (!resource) {
            setError("Por favor, insira um prefixo ou endereço IP.");
            return;
        }

        setLoading(true);
        setError(null);
        setResults(null);

        try {
            const data = await apiInstance.fetchLookingGlassData({
                resource,
                lookBackLimit: lookBackLimit,
            });

            if ((data as any).status === "error") {
                throw new Error((data as any).messages?.[0]?.[1] || "Erro desconhecido na API");
            }

            setResults(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erro ao consultar Looking Glass");
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleQuery();
        }
    };

    const toggleRRC = (rrcId: string) => {
        setExpandedRRC(expandedRRC === rrcId ? null : rrcId);
    };

    return (
        <div className="w-full space-y-6">
            {/* Cabeçalho */}
            <Card>
                <CardHeader>
                    <CardTitle>Looking Glass - Consulta de Rotas BGP</CardTitle>
                    <CardDescription>
                        Consulte informações de roteamento BGP para um prefixo ou endereço IP
                    </CardDescription>
                </CardHeader>
            </Card>

            {/* Formulário de Busca */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Parâmetros de Busca</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Campo de Recurso */}
                    <div className="space-y-2">
                        <label htmlFor="resource" className="block text-sm font-medium">
                            Prefixo ou Endereço IP *
                        </label>
                        <Input
                            id="resource"
                            placeholder="Ex: 192.0.2.0/24 ou 2001:db8::/32 ou 8.8.8.8"
                            value={resource}
                            onChange={(e) => setResource(e.target.value)}
                            onKeyPress={handleKeyPress}
                            disabled={loading}
                            className="font-mono bg-background text-foreground"
                        />
                        <p className="text-xs text-muted-foreground">
                            Insira um prefixo IPv4/IPv6 ou um endereço IP para consultar as rotas anunciadas.
                        </p>
                    </div>

                    {/* Campo de Look Back Limit */}
                    <div className="space-y-2">
                        <label htmlFor="lookBackLimit" className="block text-sm font-medium">
                            Período de Consulta (segundos)
                        </label>
                        <Input
                            id="lookBackLimit"
                            type="number"
                            value={lookBackLimit}
                            onChange={(e) => setLookBackLimit(parseInt(e.target.value) || 86400)}
                            disabled={loading}
                            min={3600}
                            step={3600}
                            className="bg-background text-foreground"
                        />
                        <p className="text-xs text-muted-foreground">
                            Padrão: 86400 segundos (24 horas). Mínimo: 3600 segundos (1 hora).
                        </p>
                    </div>

                    {/* Botão de Busca */}
                    <Button onClick={handleQuery} disabled={loading} className="w-full">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {loading ? "Consultando..." : "Consultar Looking Glass"}
                    </Button>
                </CardContent>
            </Card>

            {/* Mensagem de Erro */}
            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Resultados */}
            {results && (
                <div className="space-y-4">
                    {/* Resumo dos Resultados */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                Resultados da Consulta
                            </CardTitle>
                            <CardDescription>
                                Consultado em: {new Date(results.query_time).toLocaleString("pt-BR")}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="p-3 bg-muted rounded">
                                    <p className="text-xs text-muted-foreground">Total de RRCs</p>
                                    <p className="text-2xl font-bold">{results.data.rrcs.length}</p>
                                </div>
                                <div className="p-3 bg-muted rounded">
                                    <p className="text-xs text-muted-foreground">Total de Peers</p>
                                    <p className="text-2xl font-bold">
                                        {results.data.rrcs.reduce((sum, rrc) => sum + rrc.peers.length, 0)}
                                    </p>
                                </div>
                                <div className="p-3 bg-muted rounded">
                                    <p className="text-xs text-muted-foreground">Última Atualização</p>
                                    <p className="text-sm font-mono">{results.data.latest_time}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Detalhes por RRC */}
                    {results.data.rrcs.map((rrc) => (
                        <Card key={rrc.rrc_id}>
                            <CardHeader
                                className="cursor-pointer hover:bg-accent/50"
                                onClick={() => toggleRRC(rrc.rrc_id)}
                            >
                                <CardTitle className="text-base flex items-center justify-between">
                                    <span>
                                        RRC {rrc.rrc_id} - {rrc.location} ({rrc.country})
                                    </span>
                                    <span className="text-sm text-muted-foreground">{rrc.peers.length} peers</span>
                                </CardTitle>
                            </CardHeader>

                            {expandedRRC === rrc.rrc_id && (
                                <CardContent className="space-y-4">
                                    {rrc.peers.length > 0 ? (
                                        rrc.peers.map((peer, idx) => (
                                            <div key={idx} className="p-4 border rounded bg-muted/30 space-y-2">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">Prefixo</p>
                                                        <p className="font-mono text-base">{peer.prefix}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">ASN Origem</p>
                                                        <p className="font-mono text-base">{peer.asn_origin}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">AS Path</p>
                                                        <p className="font-mono text-xs break-all">{peer.as_path}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">Next Hop</p>
                                                        <p className="font-mono text-base">{peer.next_hop}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">Peer BGP</p>
                                                        <p className="font-mono text-base">{peer.peer}</p>
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-muted-foreground">Origem</p>
                                                        <p className="font-mono text-base">{peer.origin}</p>
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <p className="text-xs font-semibold text-muted-foreground">Última Atualização</p>
                                                        <p className="text-xs">
                                                            {new Date(peer.last_updated).toLocaleString("pt-BR")}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-muted-foreground text-sm">Nenhum peer encontrado para este RRC</p>
                                    )}
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            {/* Mensagem de Vazio */}
            {!results && !loading && !error && (
                <Card className="border-dashed">
                    <CardContent className="pt-6 text-center text-gray-500">
                        <p>Insira um prefixo ou endereço IP e clique em "Consultar Looking Glass" para começar.</p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default LookingGlass;
