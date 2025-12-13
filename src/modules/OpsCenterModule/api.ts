/**
 * Cliente API para o Módulo Ops Center
 * Arquivo: src/modules/OpsCenterModule/api.ts
 */

import {
  LookingGlassQuery,
  LookingGlassResponse,
  IRRSearchQuery,
  IRRSearchResponse,
  IRRSubmissionRequest,
  IRRSubmissionResponse,
  OpsCenterModuleConfig,
} from "./types";

export class OpsCenterModuleAPI {
  private config: OpsCenterModuleConfig;

  constructor(config?: Partial<OpsCenterModuleConfig>) {
    this.config = {
      ripestatApiUrl: "/api/proxy/ripestat",
      bgpNetBrGraphQLUrl: "/api/proxy/bgpbr/graphql",
      bgpNetBrSubmitUrl: "/api/proxy/bgpbr/submit",
      defaultLookBackLimit: 86400,
      enableIRRSubmission: false,
      irrAuthMethod: "none",
      ...config,
    };
  }

  // =========================================================================
  // LOOKING GLASS (RIPEstat API)
  // =========================================================================

  /**
   * Busca dados de Looking Glass via RIPEstat API
   * @param query - Parâmetros da consulta
   * @returns Dados do Looking Glass
   */
  async fetchLookingGlassData(query: LookingGlassQuery): Promise<LookingGlassResponse> {
    const resource = query.resource;
    const lookBack = query.lookBackLimit || this.config.defaultLookBackLimit;

    try {
      const url = `${this.config.ripestatApiUrl}?resource=${resource}&look_back_limit=${lookBack}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Erro na API RIPEstat: ${response.statusText}`);
      }

      const data: LookingGlassResponse = await response.json();
      return data;
    } catch (error) {
      console.error("Erro ao consultar Looking Glass:", error);
      throw error;
    }
  }

  /**
   * Formata os resultados do Looking Glass para exibição
   * @param response - Resposta da API RIPEstat
   * @returns Array de strings formatadas para exibição
   */
  formatLookingGlassResults(response: LookingGlassResponse): string[] {
    const results: string[] = [];

    if (!response.data || !response.data.rrcs) {
      return ["Nenhum resultado encontrado"];
    }

    response.data.rrcs.forEach((rrc) => {
      results.push(`\n=== RRC ${rrc.rrc_id} (${rrc.location}, ${rrc.country}) ===`);

      rrc.peers.forEach((peer) => {
        results.push(`Prefixo: ${peer.prefix}`);
        results.push(`AS Path: ${peer.as_path}`);
        results.push(`ASN Origem: ${peer.asn_origin}`);
        results.push(`Next Hop: ${peer.next_hop}`);
        results.push(`Peer: ${peer.peer}`);
        results.push(`Origem: ${peer.origin}`);
        results.push(`Última Atualização: ${peer.last_updated}`);
        results.push("---");
      });
    });

    return results;
  }

  // =========================================================================
  // GERENCIAMENTO DE IRR (bgp.net.br GraphQL)
  // =========================================================================

  /**
   * Busca objetos RPSL na base de dados IRR via GraphQL
   * @param query - Parâmetros de busca
   * @returns Resultados da busca
   */
  async searchIRRObjects(query: IRRSearchQuery): Promise<IRRSearchResponse> {
    try {
      // Construir a query GraphQL
      const graphQLQuery = this.buildIRRSearchQuery(query);

      const response = await fetch(this.config.bgpNetBrGraphQLUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: graphQLQuery,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro na API bgp.net.br: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      // Verificar se houve erros na resposta GraphQL
      if (data.errors) {
        throw new Error(`Erro GraphQL: ${data.errors.map((e: any) => e.message).join(", ")}`);
      }

      // Processar a resposta
      const rawObjects = data.data?.rpslObjects || [];
      const objects = rawObjects.map((obj: any) => ({
        objectClass: obj.objectClass,
        primaryKey: obj.rpslPk,
        source: obj.source,
        attributes: this.parseRPSLAttributes(obj.objectText),
      }));

      return {
        objects,
        totalCount: objects.length,
        hasMore: false,
      };
    } catch (error) {
      console.error("Erro ao buscar objetos IRR:", error);
      throw error;
    }
  }

  /**
   * Constrói uma query GraphQL para buscar objetos RPSL
   * @param query - Parâmetros de busca
   * @returns String com a query GraphQL
   */
  private buildIRRSearchQuery(query: IRRSearchQuery): string {
    let filters = "";

    if (query.textSearch) {
      filters += `textSearch: "${query.textSearch}"`;
    }

    if (query.objectClass) {
      if (filters) filters += ", ";
      filters += `objectClass: ["${query.objectClass}"]`;
    }

    if (query.sources && query.sources.length > 0) {
      if (filters) filters += ", ";
      filters += `sources: [${query.sources.map((s) => `"${s}"`).join(", ")}]`;
    }

    if (query.limit) {
      if (filters) filters += ", ";
      filters += `recordLimit: ${query.limit}`;
    }

    if (query.offset) {
      // Offset seems not directly supported or named differently.
      // Ignoring for now.
    }

    return `
      query {
        rpslObjects(${filters}) {
          objectClass
          rpslPk
          source
          objectText
        }
      }
    `;
  }

  /**
   * Faz o parse do texto RPSL para uma lista de atributos
   */
  private parseRPSLAttributes(text: string): { name: string; value: string }[] {
    if (!text) return [];

    const lines = text.split('\n');
    const attributes: { name: string; value: string }[] = [];
    let currentAttr: { name: string; value: string } | null = null;

    for (const line of lines) {
      if (!line.trim()) continue; // Pular linhas vazias

      // Verifica se é uma continuação (começa com espaço ou tab)
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (currentAttr) {
          currentAttr.value += ' ' + line.trim();
        }
      } else {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const name = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          currentAttr = { name, value };
          attributes.push(currentAttr);
        }
      }
    }
    return attributes;
  }

  // =========================================================================
  // SUBMISSÃO DE OBJETOS IRR (bgp.net.br REST API)
  // =========================================================================

  /**
   * Submete um objeto RPSL para a base de dados IRR
   * @param request - Objeto com o RPSL e credenciais de autenticação
   * @returns Resposta da submissão
   */
  async submitIRRObject(request: IRRSubmissionRequest): Promise<IRRSubmissionResponse> {
    try {
      if (!request.object) {
        throw new Error("O campo 'object' é obrigatório");
      }

      // Preparar o corpo da requisição
      const body = request.object;

      // Adicionar autenticação se fornecida
      let headers: Record<string, string> = {
        "Content-Type": "text/plain",
      };

      if (request.email && request.password) {
        // Codificar credenciais em Base64 para autenticação básica
        const credentials = btoa(`${request.email}:${request.password}`);
        headers["Authorization"] = `Basic ${credentials}`;
      }

      const response = await fetch(this.config.bgpNetBrSubmitUrl, {
        method: "POST",
        headers,
        body,
      });

      const responseText = await response.text();

      if (!response.ok) {
        return {
          status: "error",
          message: `Erro ao submeter objeto: ${response.statusText} - ${responseText}`,
          errors: [responseText],
        };
      }

      // Processar resposta bem-sucedida
      return {
        status: "success",
        message: "Objeto RPSL submetido com sucesso",
        objectKey: this.extractObjectKey(request.object),
      };
    } catch (error) {
      console.error("Erro ao submeter objeto IRR:", error);
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Erro desconhecido",
        errors: [error instanceof Error ? error.message : "Erro desconhecido"],
      };
    }
  }

  /**
   * Extrai a chave primária de um objeto RPSL
   * @param rpslObject - Objeto RPSL em formato texto
   * @returns Chave primária do objeto
   */
  private extractObjectKey(rpslObject: string): string {
    const lines = rpslObject.split("\n");
    for (const line of lines) {
      if (line.startsWith("route:") || line.startsWith("route6:")) {
        return line.split(":")[1].trim();
      }
      if (line.startsWith("aut-num:")) {
        return line.split(":")[1].trim();
      }
    }
    return "unknown";
  }

  /**
   * Valida a sintaxe de um objeto RPSL
   * @param rpslObject - Objeto RPSL em formato texto
   * @returns true se válido, false caso contrário
   */
  validateRPSLObject(rpslObject: string): boolean {
    if (!rpslObject || rpslObject.trim().length === 0) {
      return false;
    }

    // Verificar se contém pelo menos uma linha com um atributo válido
    const lines = rpslObject.split("\n");
    const validAttributes = [
      "route:",
      "route6:",
      "aut-num:",
      "as-set:",
      "mntner:",
      "person:",
      "role:",
      "origin:",
      "mnt-by:",
      "descr:",
    ];

    return lines.some((line) => validAttributes.some((attr) => line.startsWith(attr)));
  }

  /**
   * Formata um objeto RPSL para exibição
   * @param rpslObject - Objeto RPSL em formato texto
   * @returns Objeto formatado com estrutura clara
   */
  formatRPSLObject(rpslObject: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = rpslObject.split("\n");

    for (const line of lines) {
      const match = line.match(/^([a-z0-9\-]+):\s*(.+)$/i);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Atualiza a configuração da API
   * @param config - Nova configuração (parcial)
   */
  updateConfig(config: Partial<OpsCenterModuleConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Retorna a configuração atual
   * @returns Configuração atual
   */
  getConfig(): OpsCenterModuleConfig {
    return { ...this.config };
  }
}

// Exportar uma instância padrão
export const opsCenterAPI = new OpsCenterModuleAPI();
