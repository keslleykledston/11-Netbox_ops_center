/**
 * Componente Principal do Módulo Ops Center
 * Arquivo: src/modules/OpsCenterModule/OpsCenterModule.tsx
 */

import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LookingGlass } from "./LookingGlass";
import { IRRManager } from "./IRRManager";
import { OpsCenterModuleAPI } from "./api";
import { Globe, Database } from "lucide-react";

interface OpsCenterModuleProps {
    apiConfig?: any;
}

export const OpsCenterModule: React.FC<OpsCenterModuleProps> = ({ apiConfig }) => {
    // Inicializar a instância da API com a configuração fornecida
    const apiInstance = new OpsCenterModuleAPI(apiConfig);

    return (
        <div className="w-full min-h-screen bg-gray-50 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Cabeçalho Principal */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">NetBox Ops Center</h1>
                    <p className="text-lg text-gray-600">
                        Ferramentas avançadas para gerenciamento de BGP e IRR
                    </p>
                </div>

                {/* Abas Principais */}
                <Tabs defaultValue="looking-glass" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-6">
                        <TabsTrigger value="looking-glass" className="flex items-center gap-2">
                            <Globe className="h-4 w-4" />
                            Looking Glass
                        </TabsTrigger>
                        <TabsTrigger value="irr-manager" className="flex items-center gap-2">
                            <Database className="h-4 w-4" />
                            Gerenciador de IRR
                        </TabsTrigger>
                    </TabsList>

                    {/* Conteúdo da Aba Looking Glass */}
                    <TabsContent value="looking-glass" className="space-y-6">
                        <LookingGlass apiInstance={apiInstance} />
                    </TabsContent>

                    {/* Conteúdo da Aba IRR Manager */}
                    <TabsContent value="irr-manager" className="space-y-6">
                        <IRRManager apiInstance={apiInstance} />
                    </TabsContent>
                </Tabs>

                {/* Rodapé com Informações */}
                <div className="mt-12 border-t pt-8">
                    <Card className="bg-blue-50 border-blue-200">
                        <CardHeader>
                            <CardTitle className="text-base">Sobre este Módulo</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-gray-700">
                            <p>
                                <strong>Looking Glass:</strong> Consulte informações de roteamento BGP em tempo real
                                usando a API pública do RIPEstat. Obtenha detalhes sobre prefixos, AS paths e peers
                                BGP.
                            </p>
                            <p>
                                <strong>Gerenciador de IRR:</strong> Busque e mantenha objetos RPSL na base de dados
                                IRR do bgp.net.br. Consulte rotas, ASNs, maintainers e outros objetos de roteamento.
                            </p>
                            <p className="text-xs text-gray-600">
                                <strong>Nota:</strong> Este módulo utiliza APIs públicas. Algumas funcionalidades podem
                                exigir autenticação ou ter limitações de taxa de requisição.
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default OpsCenterModule;
