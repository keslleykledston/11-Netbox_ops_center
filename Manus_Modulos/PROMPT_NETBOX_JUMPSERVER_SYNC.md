# 🔄 PROMPT: Implementar Sincronização NetBox ↔ JumpServer no NetBox Ops Center

## 📋 Contexto da Aplicação

Você está trabalhando no **NetBox Ops Center** (https://github.com/keslleykledston/11-Netbox_ops_center), uma plataforma de gestão de rede que integra NetBox, Oxidized, LibreNMS e outras ferramentas. A aplicação já possui:

- **Backend**: Node.js + Express + BullMQ (para jobs assíncronos)
- **Frontend**: React + Vite + shadcn/ui
- **Banco de dados**: PostgreSQL + Prisma ORM
- **Arquitetura**: Multi-worker (backend, worker, scheduler)
- **Integrações existentes**: NetBox, Oxidized, LibreNMS

**Estrutura relevante atual:**
```
server/
├── src/
│   ├── index.js          # API principal (Express + WebSocket)
│   ├── worker.js         # Worker BullMQ (jobs assíncronos)
│   ├── scheduler.js      # Scheduler (jobs periódicos)
│   ├── netbox.js         # Integração NetBox existente
│   └── queues/           # Jobs assíncronos (BullMQ)
├── prisma/
│   └── schema.prisma     # Schema do banco PostgreSQL
src/
├── pages/
│   ├── Apps.tsx          # Página de gestão de aplicações integradas
│   └── Sync.tsx          # Página de sincronização (a ser criada/expandida)
```

---

## 🎯 Objetivo da Funcionalidade

Criar um **mecanismo de sincronização bidirecional** entre NetBox e JumpServer que:

1. **Coleta dispositivos** registrados no NetBox (filtrados por Tenant Group)
2. **Verifica existência** no JumpServer baseado em:
   - Nome (exato ou similar usando fuzzy matching)
   - Endereço IP primário
   - Node/Tenant correspondente
3. **Armazena ID do JumpServer** em campo personalizado do NetBox (`custom_fields.jumpserver_asset_id`)
4. **Lista pendências** para aprovação manual (Sanity Check) antes de criar/atualizar
5. **Não remove** dados de nenhum sistema (somente leitura + escrita aprovada)
6. **Processa em multi-thread** e por lotes para evitar sobrecarga de APIs
7. **Integra-se perfeitamente** com a aplicação existente

---

## 🔧 Requisitos Técnicos Detalhados

### 1. **Integração com Backend Existente**

**Arquivo:** `server/src/jumpserver.js` (criar novo módulo)

```javascript
// Estrutura sugerida para server/src/jumpserver.js
import axios from 'axios';
import { getAuth, getHeaders } from './auth/jumpserver-auth.js'; // Criar módulo de autenticação HTTPSignature

export class JumpServerAPI {
  constructor(baseUrl, accessKeyId, accessKeySecret, orgId) {
    this.baseUrl = baseUrl;
    this.auth = getAuth(accessKeyId, accessKeySecret);
    this.orgId = orgId;
  }

  // Métodos a implementar:
  // - listNodes() - Lista todos os nodes (tenants)
  // - listAssets(nodeId) - Lista assets de um node específico
  // - getAssetByName(name) - Busca asset por nome (fuzzy matching)
  // - getAssetByIP(ip) - Busca asset por IP
  // - createAsset(data) - Cria novo asset
  // - updateAsset(id, data) - Atualiza asset existente
}
```

**Dependências necessárias:**
- `httpsig` para autenticação HTTPSignature do JumpServer
- `fuse.js` para fuzzy matching de nomes

---

### 2. **Modelo de Dados - Schema Prisma**

**Adicionar ao `server/prisma/schema.prisma`:**

```prisma
model SyncJob {
  id                 String   @id @default(uuid())
  status             String   // 'pending', 'running', 'completed', 'failed'
  type               String   // 'full', 'incremental', 'manual'
  startedAt          DateTime @default(now())
  completedAt        DateTime?
  totalDevices       Int      @default(0)
  processedDevices   Int      @default(0)
  createdAssets      Int      @default(0)
  updatedAssets      Int      @default(0)
  errors             Json?    // Array de erros
  config             Json?    // Configurações específicas do job
  
  pendingActions     PendingAction[]
  
  @@index([status, startedAt])
}

model PendingAction {
  id              String   @id @default(uuid())
  syncJobId       String
  syncJob         SyncJob  @relation(fields: [syncJobId], references: [id], onDelete: Cascade)
  
  action          String   // 'create', 'update', 'skip'
  deviceId        String   // ID do dispositivo no NetBox
  deviceName      String
  deviceIP        String?
  tenantName      String
  
  matchScore      Float?   // Score de similaridade (0-1)
  matchedAssetId  String?  // ID do asset no JumpServer (se encontrado)
  
  status          String   // 'pending', 'approved', 'rejected'
  approvedBy      String?
  approvedAt      DateTime?
  
  netboxData      Json     // Dados completos do NetBox
  jumpserverData  Json?    // Dados do JumpServer (se encontrado)
  
  createdAt       DateTime @default(now())
  
  @@index([syncJobId, status])
  @@index([status, createdAt])
}
```

---

### 3. **Queue de Sincronização - BullMQ Job**

**Arquivo:** `server/src/queues/jumpserver-sync.js` (criar novo)

```javascript
import { Queue, Worker } from 'bullmq';
import { connection } from '../config/redis.js'; // Usar Redis existente
import { JumpServerAPI } from '../jumpserver.js';
import { NetBoxAPI } from '../netbox.js';
import { PrismaClient } from '@prisma/client';
import Fuse from 'fuse.js';

const prisma = new PrismaClient();

// Queue para jobs de sincronização
export const jumpserverSyncQueue = new Queue('jumpserver-sync', { connection });

// Configurações para multi-threading
const CONCURRENT_JOBS = 3; // Número de jobs simultâneos
const BATCH_SIZE = 50;     // Dispositivos por lote

// Worker que processa os jobs
export const jumpserverSyncWorker = new Worker(
  'jumpserver-sync',
  async (job) => {
    const { syncJobId, batchDevices, config } = job.data;
    
    // Implementar lógica de:
    // 1. Para cada dispositivo do lote:
    //    a. Buscar no JumpServer por nome (fuzzy) e IP
    //    b. Calcular score de similaridade
    //    c. Se encontrado: registrar para atualização
    //    d. Se não encontrado: registrar para criação
    // 2. Salvar PendingActions no banco
    // 3. Atualizar progresso do SyncJob
    
    // Retornar estatísticas
    return {
      processed: batchDevices.length,
      found: foundCount,
      notFound: notFoundCount
    };
  },
  { 
    connection,
    concurrency: CONCURRENT_JOBS,
    limiter: {
      max: 10,        // Máximo de jobs por intervalo
      duration: 1000  // Intervalo em ms (proteção de API)
    }
  }
);
```

---

### 4. **API Endpoints - Backend**

**Adicionar ao `server/src/index.js`:**

```javascript
// ========== JUMPSERVER SYNC ENDPOINTS ==========

// Iniciar sincronização
app.post('/api/jumpserver/sync/start', authenticate, async (req, res) => {
  const { mode, filters } = req.body; // mode: 'full' | 'incremental' | 'by-tenant'
  
  // 1. Criar SyncJob no banco
  // 2. Coletar dispositivos do NetBox (com filtros)
  // 3. Dividir em lotes
  // 4. Adicionar jobs na queue
  // 5. Retornar ID do SyncJob
});

// Listar ações pendentes (Sanity Check)
app.get('/api/jumpserver/sync/:jobId/pending', authenticate, async (req, res) => {
  // Buscar PendingActions do job específico
  // Filtrar por status 'pending'
  // Retornar com dados formatados para UI
});

// Aprovar/Rejeitar ação
app.post('/api/jumpserver/sync/pending/:actionId/approve', authenticate, async (req, res) => {
  const { action } = req.body; // 'approve' | 'reject'
  
  // 1. Atualizar status da PendingAction
  // 2. Se aprovado: executar criação/atualização no JumpServer
  // 3. Atualizar custom_field no NetBox com ID do asset
});

// Status de sincronização
app.get('/api/jumpserver/sync/:jobId/status', authenticate, async (req, res) => {
  // Retornar estatísticas do SyncJob
});

// Histórico de sincronizações
app.get('/api/jumpserver/sync/history', authenticate, async (req, res) => {
  // Listar todos os SyncJobs com paginação
});
```

---

### 5. **Interface Frontend - Página de Sincronização**

**Arquivo:** `src/pages/JumpServerSync.tsx` (criar novo)

**Componentes principais:**

```tsx
// Estrutura da página:
// 1. Header com botão "Iniciar Sincronização"
// 2. Filtros: Tenant, Site, Status
// 3. Tabela de ações pendentes (DataTable do shadcn)
// 4. Modal de confirmação em lote
// 5. Gráfico de progresso (Chart.js ou Recharts)

// Colunas da tabela:
const columns = [
  { id: 'status', header: 'Status' },       // Badge colorido
  { id: 'action', header: 'Ação' },         // 'Criar' | 'Atualizar' | 'Ignorar'
  { id: 'deviceName', header: 'Dispositivo' },
  { id: 'deviceIP', header: 'IP' },
  { id: 'tenantName', header: 'Tenant' },
  { id: 'matchScore', header: 'Similaridade' }, // Barra de progresso visual
  { id: 'matchedAsset', header: 'Asset no JumpServer' }, // Link se encontrado
  { id: 'actions', header: 'Ações' }        // Botões Aprovar/Rejeitar
];

// Funcionalidades:
// - Filtro em tempo real
// - Seleção múltipla com checkbox
// - Aprovar/Rejeitar em lote
// - WebSocket para atualização em tempo real do progresso
// - Export CSV/Excel das ações pendentes
```

---

### 6. **Fuzzy Matching e Validação**

**Algoritmo de matching:**

```javascript
// Em server/src/utils/device-matcher.js (criar novo)
import Fuse from 'fuse.js';

export function findBestMatch(netboxDevice, jumpserverAssets) {
  // Preparar opções do Fuse.js
  const options = {
    keys: [
      { name: 'name', weight: 0.6 },
      { name: 'address', weight: 0.4 }
    ],
    threshold: 0.3,  // 0 = exato, 1 = qualquer coisa
    includeScore: true
  };
  
  const fuse = new Fuse(jumpserverAssets, options);
  
  // Buscar por nome
  const nameResults = fuse.search(netboxDevice.name);
  
  // Buscar por IP (exato)
  const ipMatch = jumpserverAssets.find(
    asset => asset.address === netboxDevice.primary_ip?.address.split('/')[0]
  );
  
  // Lógica de decisão:
  // 1. IP exato = match perfeito (score 1.0)
  // 2. Nome similar (score > 0.7) + IP próximo = provável match
  // 3. Nome similar (score > 0.7) sem IP = sugerir para revisão
  // 4. Nome diferente + IP diferente = criar novo
  
  return {
    found: ipMatch || nameResults[0]?.item,
    score: ipMatch ? 1.0 : (1 - (nameResults[0]?.score || 1)),
    confidence: ipMatch ? 'high' : (nameResults[0]?.score < 0.3 ? 'medium' : 'low')
  };
}
```

---

### 7. **Configuração Automática (Scheduler)**

**Adicionar ao `server/src/scheduler.js`:**

```javascript
// Job periódico (a cada 10 minutos - configurável)
cron.schedule('*/10 * * * *', async () => {
  if (process.env.JUMPSERVER_AUTO_SYNC !== 'true') return;
  
  console.log('🔄 Iniciando sincronização automática NetBox ↔ JumpServer...');
  
  // Verificar se já existe job em execução
  const runningJobs = await prisma.syncJob.findMany({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' },
    take: 1
  });
  
  if (runningJobs.length > 0) {
    console.log('⏭️  Job já em execução, pulando...');
    return;
  }
  
  // Iniciar sincronização incremental
  // (apenas dispositivos modificados desde última sync)
});
```

---

### 8. **Variáveis de Ambiente**

**Adicionar ao `.env.example`:**

```bash
# ========== JUMPSERVER CONFIGURATION ==========
JUMPSERVER_URL=http://js.k3gsolutions.com.br
JUMPSERVER_ACCESS_KEY_ID=
JUMPSERVER_ACCESS_KEY_SECRET=
JUMPSERVER_ORG_ID=00000000-0000-0000-0000-000000000002

# Sincronização automática
JUMPSERVER_AUTO_SYNC=false
JUMPSERVER_SYNC_INTERVAL=10  # minutos

# Configurações de processamento
JUMPSERVER_BATCH_SIZE=50
JUMPSERVER_CONCURRENT_JOBS=3
JUMPSERVER_FUZZY_THRESHOLD=0.7  # 0-1 (0=exato, 1=qualquer)

# Campo personalizado no NetBox para armazenar ID do JumpServer
NETBOX_JUMPSERVER_ID_FIELD=jumpserver_asset_id
```

---

### 9. **Proteções e Limitações**

**Implementar em todos os endpoints:**

```javascript
// Rate limiting por IP
import rateLimit from 'express-rate-limit';

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Máximo 5 sincronizações por janela
  message: 'Muitas tentativas de sincronização. Tente novamente em 15 minutos.'
});

app.post('/api/jumpserver/sync/start', syncLimiter, authenticate, ...);

// Validação de payload
import Joi from 'joi';

const syncSchema = Joi.object({
  mode: Joi.string().valid('full', 'incremental', 'by-tenant').required(),
  filters: Joi.object({
    tenantIds: Joi.array().items(Joi.number()),
    siteIds: Joi.array().items(Joi.number()),
    excludeInactive: Joi.boolean().default(true)
  })
});

// Timeout de API
axios.defaults.timeout = 30000; // 30 segundos

// Retry automático
import axiosRetry from 'axios-retry';
axiosRetry(axios, { 
  retries: 3, 
  retryDelay: axiosRetry.exponentialDelay 
});
```

---

### 10. **Logs e Auditoria**

**Sistema de logs detalhado:**

```javascript
// Em server/src/utils/audit-logger.js (criar novo)
import winston from 'winston';

export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/jumpserver-sync.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Registrar todas as ações:
auditLogger.info('device_matched', {
  userId: req.user.id,
  netboxDeviceId: device.id,
  jumpserverAssetId: match.id,
  score: match.score,
  action: 'update'
});
```

---

## 📊 Fluxo de Sincronização Completo

```
1. USUÁRIO INICIA SYNC
   ↓
2. BACKEND CRIA SyncJob
   ↓
3. COLETA DISPOSITIVOS DO NETBOX
   (filtra por Tenant Group, Status, etc)
   ↓
4. DIVIDE EM LOTES (BATCH_SIZE)
   ↓
5. ADICIONA JOBS NA QUEUE (BullMQ)
   ├─ Job 1: Dispositivos 1-50
   ├─ Job 2: Dispositivos 51-100
   └─ Job 3: Dispositivos 101-150
   ↓
6. WORKERS PROCESSAM EM PARALELO
   Para cada dispositivo:
   ├─ Busca no JumpServer (por nome + IP)
   ├─ Calcula score de similaridade
   ├─ Cria PendingAction no banco
   └─ Atualiza progresso via WebSocket
   ↓
7. FRONTEND MOSTRA SANITY CHECK
   (tabela com ações pendentes)
   ↓
8. USUÁRIO APROVA/REJEITA
   ↓
9. BACKEND EXECUTA APROVADAS
   ├─ Cria/Atualiza asset no JumpServer
   ├─ Atualiza custom_field no NetBox
   └─ Registra auditoria
   ↓
10. SYNC COMPLETA
    (atualiza SyncJob.status = 'completed')
```

---

## 🧪 Testes e Validação

**Criar suite de testes:**

```javascript
// Em server/tests/jumpserver-sync.test.js
import { describe, it, expect } from 'vitest';
import { findBestMatch } from '../src/utils/device-matcher.js';

describe('JumpServer Sync', () => {
  it('deve encontrar match perfeito por IP', () => {
    const netboxDevice = { 
      name: 'SW-CORE-01', 
      primary_ip: { address: '10.0.0.1/24' } 
    };
    const jsAssets = [
      { name: 'SW-CORE-1', address: '10.0.0.1' }
    ];
    
    const result = findBestMatch(netboxDevice, jsAssets);
    expect(result.score).toBe(1.0);
    expect(result.confidence).toBe('high');
  });
  
  it('deve sugerir match por nome similar', () => {
    const netboxDevice = { 
      name: 'RTR-EDGE-SP-01', 
      primary_ip: null 
    };
    const jsAssets = [
      { name: 'RTR-EDGE-SP01', address: '192.168.1.1' }
    ];
    
    const result = findBestMatch(netboxDevice, jsAssets);
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.confidence).toBe('medium');
  });
});
```

---

## 📦 Checklist de Implementação

**Ordem recomendada:**

- [ ] 1. Criar módulo `server/src/jumpserver.js` com autenticação HTTPSignature
- [ ] 2. Adicionar schemas Prisma (`SyncJob`, `PendingAction`)
- [ ] 3. Criar queue `jumpserver-sync.js` com worker multi-thread
- [ ] 4. Implementar fuzzy matching em `device-matcher.js`
- [ ] 5. Adicionar endpoints de API no `index.js`
- [ ] 6. Criar página frontend `JumpServerSync.tsx` com tabela interativa
- [ ] 7. Configurar WebSocket para updates em tempo real
- [ ] 8. Adicionar job periódico no scheduler (opcional)
- [ ] 9. Implementar sistema de logs e auditoria
- [ ] 10. Criar testes automatizados
- [ ] 11. Documentar API (Swagger/OpenAPI)
- [ ] 12. Atualizar README com instruções de configuração

---

## 🎨 Melhorias Futuras (Opcional)

1. **Machine Learning**: Treinar modelo para melhorar precisão de matching
2. **Rollback**: Desfazer sincronizações em caso de erro
3. **Notificações**: Email/Telegram quando sync completar
4. **Relatórios**: PDF/Excel com resumo de sincronizações
5. **API GraphQL**: Consultas mais flexíveis
6. **Multi-JumpServer**: Suportar múltiplas instâncias

---

## 🔐 Segurança

**Pontos críticos:**

- ✅ Nunca logar credenciais nos arquivos de log
- ✅ Validar todos os inputs (Joi schema)
- ✅ Rate limiting em todos os endpoints de sync
- ✅ Autenticação obrigatória (JWT)
- ✅ HTTPS obrigatório em produção
- ✅ Sanitizar dados antes de salvar no banco
- ✅ Criptografar custom_fields sensíveis

---

## 📖 Documentação Adicional

**Referências úteis:**

- [JumpServer API Docs](https://docs.jumpserver.org/zh/master/dev/rest_api/)
- [NetBox API Schema](https://netbox.duxnet.com.br/api/schema/swagger-ui/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Fuse.js (Fuzzy Search)](https://fusejs.io/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)

---

## 🚀 Início Rápido

### Instalação de Dependências

```bash
# No diretório server/
npm install httpsig fuse.js express-rate-limit joi axios-retry winston

# Adicionar tipos TypeScript (se necessário)
npm install -D @types/node @types/express
```

### Migração do Banco de Dados

```bash
cd server
npx prisma migrate dev --name add_jumpserver_sync_tables
npx prisma generate
```

### Configuração Mínima

```bash
# Copiar .env.example para .env
cp .env.example .env

# Editar .env e preencher:
# - JUMPSERVER_URL
# - JUMPSERVER_ACCESS_KEY_ID
# - JUMPSERVER_ACCESS_KEY_SECRET
# - JUMPSERVER_ORG_ID
```

### Executar em Desenvolvimento

```bash
# Terminal 1: Backend
cd server
npm run dev

# Terminal 2: Worker
cd server
node src/worker.js

# Terminal 3: Frontend
npm run dev
```

---

## 📞 Suporte e Contribuição

**Dúvidas ou problemas?**

1. Verifique os logs em `server/logs/jumpserver-sync.log`
2. Consulte a documentação das APIs
3. Abra uma issue no GitHub com detalhes do erro

**Contribuindo:**

1. Fork o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

---

**Última atualização:** 19/12/2024  
**Versão:** 1.0.0  
**Autor:** K3G Solutions - Keslley Kledston  

---

**Prompt completo e pronto para uso!** 🚀

Este documento contém todos os detalhes técnicos necessários para implementar a funcionalidade de sincronização NetBox ↔ JumpServer de forma robusta, escalável e integrada à arquitetura existente do NetBox Ops Center.
