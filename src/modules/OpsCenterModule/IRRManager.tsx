/**
 * Componente React para Gerenciamento de IRR
 * Arquivo: src/modules/OpsCenterModule/IRRManager.tsx
 */

import React, { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { OpsCenterModuleAPI } from "./api";
import { IRRSearchQuery, IRRSubmissionRequest, IRRObject } from "./types";

interface IRRManagerProps {
    apiInstance?: OpsCenterModuleAPI;
}

export const IRRManager: React.FC<IRRManagerProps> = ({
    apiInstance,
}) => {
    // Use a local instance if not provided, but we need to handle the case where apiInstance is undefined
    // However, props destructuring with default value is safer if the class can be instantiated.
    // Ideally, apiInstance should be passed or provided by context.
    // For now, creating a default instance if missing or handling it.
    const api = apiInstance || new OpsCenterModuleAPI();

    // Estado para a aba de Consulta
    const [searchText, setSearchText] = useState<string>("");
    const [searchObjectClass, setSearchObjectClass] = useState<string>("");
    const [searchLoading, setSearchLoading] = useState<boolean>(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<IRRObject[]>([]);
    const [expandedObject, setExpandedObject] = useState<number | null>(null);

    // Estado para a aba de Submissão
    const [rpslObject, setRpslObject] = useState<string>("");
    const [submissionEmail, setSubmissionEmail] = useState<string>("");
    const [submissionPassword, setSubmissionPassword] = useState<string>("");
    const [submissionLoading, setSubmissionLoading] = useState<boolean>(false);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);

    // Funções para a aba de Consulta
    const handleSearch = useCallback(async () => {
        if (!searchText.trim() && !searchObjectClass) {
            setSearchError("Por favor, insira um termo de busca ou selecione um tipo de objeto");
            return;
        }

        setSearchLoading(true);
        setSearchError(null);
        setSearchResults([]);

        try {
            const query: IRRSearchQuery = {
                textSearch: searchText.trim() || undefined,
                objectClass: searchObjectClass || undefined,
                limit: 50,
            };

            const response = await api.searchIRRObjects(query);
            setSearchResults(response.objects);
        } catch (err) {
            setSearchError(
                err instanceof Error ? err.message : "Erro desconhecido ao buscar objetos IRR"
            );
        } finally {
            setSearchLoading(false);
        }
    }, [searchText, searchObjectClass, api]);

    const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleSearch();
        }
    };

    const toggleObjectExpanded = (idx: number) => {
        setExpandedObject(expandedObject === idx ? null : idx);
    };

    // Funções para a aba de Submissão
    const validateAndFormatRPSL = (text: string): boolean => {
        const isValid = api.validateRPSLObject(text);
        if (!isValid) {
            setValidationError(
                "Objeto RPSL inválido. Certifique-se de que contém atributos válidos (route:, origin:, mnt-by:, etc.)"
            );
        } else {
            setValidationError(null);
        }
        return isValid;
    };

    const handleRPSLChange = (text: string) => {
        setRpslObject(text);
        if (text.trim()) {
            validateAndFormatRPSL(text);
        } else {
            setValidationError(null);
        }
    };

    const handleSubmit = useCallback(async () => {
        if (!validateAndFormatRPSL(rpslObject)) {
            return;
        }

        setSubmissionLoading(true);
        setSubmissionError(null);
        setSubmissionSuccess(null);

        try {
            const request: IRRSubmissionRequest = {
                object: rpslObject,
                email: submissionEmail || undefined,
                password: submissionPassword || undefined,
            };

            const response = await api.submitIRRObject(request);

            if (response.status === "success") {
                setSubmissionSuccess(`Objeto submetido com sucesso! Chave: ${response.objectKey}`);
                setRpslObject("");
                setSubmissionEmail("");
                setSubmissionPassword("");
            } else {
                setSubmissionError(response.message || "Erro ao submeter objeto");
            }
        } catch (err) {
            setSubmissionError(
                err instanceof Error ? err.message : "Erro desconhecido ao submeter objeto"
            );
        } finally {
            setSubmissionLoading(false);
        }
    }, [rpslObject, submissionEmail, submissionPassword, api]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="w-full space-y-6">
            {/* Cabeçalho */}
            <Card>
                <CardHeader>
                    <CardTitle>Gerenciador de IRR - Consulta e Manutenção</CardTitle>
                    <CardDescription>
                        Consulte e mantenha objetos RPSL na base de dados IRR (bgp.net.br)
                    </CardDescription>
                </CardHeader>
            </Card>

            {/* Abas */}
            <Tabs defaultValue="search" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="search">Consultar Objetos</TabsTrigger>
                    <TabsTrigger value="submit">Submeter Objeto</TabsTrigger>
                </TabsList>

                {/* Aba de Consulta */}
                <TabsContent value="search" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Buscar Objetos RPSL</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Campo de Busca de Texto */}
                            <div className="space-y-2">
                                <label htmlFor="searchText" className="block text-sm font-medium">
                                    Termo de Busca
                                </label>
                                <Input
                                    id="searchText"
                                    placeholder="Ex: AS28135, 192.0.2.0/24, MAINT-CLIENTEX"
                                    value={searchText}
                                    onChange={(e) => setSearchText(e.target.value)}
                                    onKeyPress={handleSearchKeyPress}
                                    disabled={searchLoading}
                                    className="font-mono bg-background text-foreground"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Busque por ASN, prefixo, maintainer ou qualquer outro atributo RPSL.
                                </p>
                            </div>

                            {/* Filtro de Tipo de Objeto */}
                            <div className="space-y-2">
                                <label htmlFor="objectClass" className="block text-sm font-medium">
                                    Tipo de Objeto (Opcional)
                                </label>
                                <select
                                    id="objectClass"
                                    value={searchObjectClass}
                                    onChange={(e) => setSearchObjectClass(e.target.value)}
                                    disabled={searchLoading}
                                    className="w-full px-3 py-2 border rounded-md text-sm bg-background text-foreground"
                                >
                                    <option value="">Todos os tipos</option>
                                    <option value="route">Route (IPv4)</option>
                                    <option value="route6">Route6 (IPv6)</option>
                                    <option value="aut-num">Aut-Num (ASN)</option>
                                    <option value="as-set">AS-Set</option>
                                    <option value="mntner">Maintainer</option>
                                    <option value="person">Person</option>
                                    <option value="role">Role</option>
                                </select>
                            </div>

                            {/* Botão de Busca */}
                            <Button onClick={handleSearch} disabled={searchLoading} className="w-full">
                                {searchLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {searchLoading ? "Buscando..." : "Buscar Objetos"}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Mensagem de Erro */}
                    {searchError && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{searchError}</AlertDescription>
                        </Alert>
                    )}

                    {/* Resultados */}
                    {searchResults.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="font-semibold text-lg flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-green-600" />
                                {searchResults.length} Objeto(s) Encontrado(s)
                            </h3>

                            {searchResults.map((obj, idx) => (
                                <Card key={idx}>
                                    <CardHeader
                                        className="cursor-pointer hover:bg-accent/50"
                                        onClick={() => toggleObjectExpanded(idx)}
                                    >
                                        <CardTitle className="text-base flex items-center justify-between">
                                            <span>
                                                <span className="text-muted-foreground">[{obj.objectClass}]</span> {obj.primaryKey}
                                            </span>
                                            <span className="text-sm text-muted-foreground">{obj.source}</span>
                                        </CardTitle>
                                    </CardHeader>

                                    {expandedObject === idx && (
                                        <CardContent className="space-y-3">
                                            <div className="bg-muted/50 p-4 rounded space-y-2">
                                                {obj.attributes.map((attr, attrIdx) => (
                                                    <div key={attrIdx} className="flex gap-4">
                                                        <span className="font-semibold text-sm min-w-[120px]">{attr.name}:</span>
                                                        <span className="text-sm font-mono flex-1 break-all">{attr.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    copyToClipboard(
                                                        obj.attributes
                                                            .map((a) => `${a.name}: ${a.value}`)
                                                            .join("\n")
                                                    )
                                                }
                                            >
                                                <Copy className="mr-2 h-4 w-4" />
                                                Copiar Objeto
                                            </Button>
                                        </CardContent>
                                    )}
                                </Card>
                            ))}
                        </div>
                    )}

                    {/* Mensagem de Vazio */}
                    {!searchResults.length && !searchLoading && !searchError && (
                        <Card className="border-dashed">
                            <CardContent className="pt-6 text-center text-muted-foreground">
                                <p>Insira um termo de busca e clique em "Buscar Objetos" para começar.</p>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Aba de Submissão */}
                <TabsContent value="submit" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Submeter Novo Objeto RPSL</CardTitle>
                            <CardDescription>
                                Crie ou atualize um objeto RPSL na base de dados IRR
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Objeto RPSL */}
                            <div className="space-y-2">
                                <label htmlFor="rpslObject" className="block text-sm font-medium">
                                    Objeto RPSL *
                                </label>
                                <Textarea
                                    id="rpslObject"
                                    placeholder={`route: 192.0.2.0/24\norigin: AS65000\nmnt-by: MAINT-EXAMPLE\ndescr: Exemplo de Rota\nsource: BGPBR`}
                                    value={rpslObject}
                                    onChange={(e) => handleRPSLChange(e.target.value)}
                                    disabled={submissionLoading}
                                    className="font-mono text-sm h-40 bg-background text-foreground"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Insira o objeto RPSL em formato texto. Cada atributo em uma linha separada.
                                </p>
                            </div>

                            {/* Validação */}
                            {validationError && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>{validationError}</AlertDescription>
                                </Alert>
                            )}

                            {/* Credenciais de Autenticação */}
                            <div className="space-y-3 p-4 bg-muted/40 rounded border">
                                <p className="text-sm font-semibold">Autenticação (Opcional)</p>
                                <div className="space-y-2">
                                    <label htmlFor="email" className="block text-sm font-medium">
                                        E-mail
                                    </label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="seu.email@example.com"
                                        value={submissionEmail}
                                        onChange={(e) => setSubmissionEmail(e.target.value)}
                                        disabled={submissionLoading}
                                        className="bg-background text-foreground"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="password" className="block text-sm font-medium">
                                        Senha
                                    </label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="Sua senha de autenticação"
                                        value={submissionPassword}
                                        onChange={(e) => setSubmissionPassword(e.target.value)}
                                        disabled={submissionLoading}
                                        className="bg-background text-foreground"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Se você não tiver credenciais, a submissão será feita sem autenticação (apenas
                                    para objetos públicos).
                                </p>
                            </div>

                            {/* Botão de Submissão */}
                            <Button onClick={handleSubmit} disabled={submissionLoading || !rpslObject.trim()} className="w-full">
                                {submissionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {submissionLoading ? "Submetendo..." : "Submeter Objeto"}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Mensagem de Erro */}
                    {submissionError && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{submissionError}</AlertDescription>
                        </Alert>
                    )}

                    {/* Mensagem de Sucesso */}
                    {submissionSuccess && (
                        <Alert className="border-green-200 bg-green-500/10">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            <AlertDescription className="text-green-600">{submissionSuccess}</AlertDescription>
                        </Alert>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default IRRManager;
