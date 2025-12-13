/**
 * Tipos TypeScript para o Módulo de Looking Glass e Gerenciamento de IRR
 * Arquivo: src/modules/OpsCenterModule/types.ts
 */

// ============================================================================
// TIPOS PARA LOOKING GLASS (RIPEstat API)
// ============================================================================

export interface LookingGlassQuery {
  resource: string; // Prefixo IPv4/IPv6 ou endereço IP
  lookBackLimit?: number; // Opcional: segundos (padrão 86400 = 24h)
}

export interface LookingGlassResponse {
  status: string;
  status_code: number;
  version: string;
  see_also: string[];
  time_to_live: number;
  cached: boolean;
  query_time: string;
  data: {
    rrcs: RRCCollector[];
    latest_time: string;
  };
  query_starttime: string;
  query_endtime: string;
}

export interface RRCCollector {
  rrc_id: string;
  location: string;
  country: string;
  peers: BGPPeer[];
}

export interface BGPPeer {
  prefix: string;
  as_path: string;
  next_hop: string;
  asn_origin: string;
  origin: string; // "IGP", "EGP", "INCOMPLETE"
  last_updated: string;
  latest_time: string;
  peer: string; // IP do peer
  community?: string[];
}

export interface LookingGlassError {
  message: string;
  code: string;
}

// ============================================================================
// TIPOS PARA GERENCIAMENTO DE IRR (bgp.net.br GraphQL e REST)
// ============================================================================

export interface IRRObject {
  objectClass: string; // "route", "route6", "aut-num", "as-set", etc.
  primaryKey: string;
  source: string; // "BGPBR", "LACNIC", etc.
  attributes: IRRAttribute[];
}

export interface IRRAttribute {
  name: string; // "route", "origin", "mnt-by", "descr", etc.
  value: string;
}

export interface IRRSearchQuery {
  textSearch?: string; // Texto para buscar
  objectClass?: string; // Filtrar por tipo de objeto
  sources?: string[]; // Filtrar por fonte (ex: ["BGPBR"])
  limit?: number; // Limite de resultados
  offset?: number; // Offset para paginação
}

export interface IRRSearchResponse {
  objects: IRRObject[];
  totalCount: number;
  hasMore: boolean;
}

export interface IRRSubmissionRequest {
  object: string; // Objeto RPSL formatado em texto
  password?: string; // Senha de autenticação (se necessário)
  email?: string; // E-mail para submissão
}

export interface IRRSubmissionResponse {
  status: "success" | "error" | "pending";
  message: string;
  objectKey?: string;
  errors?: string[];
}

export interface IRRObjectForm {
  objectClass: "route" | "route6" | "aut-num" | "as-set" | "mntner" | "person" | "role";
  attributes: Record<string, string>; // Chave: nome do atributo, Valor: valor do atributo
}

// ============================================================================
// TIPOS PARA CONFIGURAÇÃO DO MÓDULO
// ============================================================================

export interface OpsCenterModuleConfig {
  ripestatApiUrl: string;
  bgpNetBrGraphQLUrl: string;
  bgpNetBrSubmitUrl: string;
  defaultLookBackLimit: number; // Em segundos
  enableIRRSubmission: boolean;
  irrAuthMethod: "email" | "api_key" | "none"; // Método de autenticação para IRR
}

// ============================================================================
// TIPOS PARA ESTADO DA APLICAÇÃO (React Context)
// ============================================================================

export interface OpsCenterModuleState {
  lookingGlassResults: LookingGlassResponse | null;
  lookingGlassLoading: boolean;
  lookingGlassError: LookingGlassError | null;
  irrSearchResults: IRRSearchResponse | null;
  irrSearchLoading: boolean;
  irrSearchError: string | null;
  irrSubmissionStatus: IRRSubmissionResponse | null;
  irrSubmissionLoading: boolean;
}

export interface OpsCenterModuleContextType extends OpsCenterModuleState {
  queryLookingGlass: (query: LookingGlassQuery) => Promise<void>;
  searchIRRObjects: (query: IRRSearchQuery) => Promise<void>;
  submitIRRObject: (request: IRRSubmissionRequest) => Promise<void>;
  clearResults: () => void;
}
