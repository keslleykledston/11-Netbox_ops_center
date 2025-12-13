/**
 * Arquivo de Índice do Módulo Ops Center
 * Arquivo: src/modules/OpsCenterModule/index.ts
 */

// Exportar tipos
export type {
    LookingGlassQuery,
    LookingGlassResponse,
    LookingGlassError,
    RRCCollector,
    BGPPeer,
    IRRObject,
    IRRAttribute,
    IRRSearchQuery,
    IRRSearchResponse,
    IRRSubmissionRequest,
    IRRSubmissionResponse,
    IRRObjectForm,
    OpsCenterModuleConfig,
    OpsCenterModuleState,
    OpsCenterModuleContextType,
} from "./types";

// Exportar API
export { OpsCenterModuleAPI, opsCenterAPI } from "./api";

// Exportar Componentes
export { LookingGlass } from "./LookingGlass";
export { IRRManager } from "./IRRManager";
export { OpsCenterModule } from "./OpsCenterModule";
