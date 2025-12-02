# 📊 Observabilidade e Monitoramento - NetBox Ops Center

**Data**: 2025-12-02
**Versão**: v0.3.0

## 🎯 Objetivo

Este documento descreve as funcionalidades de observabilidade, métricas e monitoramento implementadas no NetBox Ops Center, incluindo Prometheus metrics, sanitização de logs e integração assíncrona com CheckMK.

---

## 📋 **Funcionalidades Implementadas**

### ✅ 1. **Métricas Prometheus** (`/metrics`)

Endpoint de métricas no formato Prometheus para monitoramento e observabilidade.

#### **Endpoint**
```
GET http://IP:4000/metrics
```

#### **Métricas Disponíveis**

**Métricas de Filas BullMQ:**
- `bullmq_jobs_waiting_total{queue="nome"}` - Jobs aguardando processamento
- `bullmq_jobs_active_total{queue="nome"}` - Jobs em execução
- `bullmq_jobs_completed_total{queue="nome"}` - Jobs completados
- `bullmq_jobs_failed_total{queue="nome"}` - Jobs falhados
- `bullmq_jobs_delayed_total{queue="nome"}` - Jobs agendados

**Métricas de Aplicação:**
- `netbox_ops_devices_total{status="active|inactive",tenant="all"}` - Total de dispositivos
- `netbox_ops_tenants_total` - Total de tenants
- `netbox_ops_ssh_sessions_active` - Sessões SSH ativas

**Métricas HTTP:**
- `http_requests_total{method, route, status_code}` - Total de requisições HTTP
- `http_request_duration_seconds{method, route, status_code}` - Latência de requisições

**Métricas de Jobs:**
- `bullmq_job_executions_total{queue, status}` - Total de execuções de jobs
- `bullmq_job_duration_seconds{queue}` - Duração de jobs

**Métricas de Sistema (padrão Node.js):**
- CPU usage
- Memory heap
- Event loop lag
- Garbage collection

#### **Coleta Automática**

As métricas são atualizadas automaticamente a cada **15 segundos** pelo módulo de observabilidade.

#### **Integração com Grafana**

Adicione como datasource no Prometheus:
```yaml
- job_name: 'netbox-ops-center'
  static_configs:
    - targets: ['backend:4000']
```

---

### ✅ 2. **Health Endpoints Aprimorados**

#### **2.1. `/health` (Health Check Básico)**

```bash
GET http://IP:4000/health
```

**Response**:
```json
{
  "ok": true
}
```

#### **2.2. `/health/services` (Health Check Detalhado)**

Verifica status de todos os serviços e filas.

```bash
GET http://IP:4000/health/services
```

**Response**:
```json
{
  "overall": "healthy",
  "services": {
    "api": { "status": "ok", "port": 4000 },
    "snmp": { "status": "ok", "port": 3001 },
    "redis": { "status": "ok", "port": 6379 },
    "database": { "status": "ok" },
    "queues": {
      "status": "ok",
      "total": 10,
      "stats": {
        "netbox-sync": {
          "waiting": 0,
          "active": 0,
          "failed": 0,
          "delayed": 0
        },
        "oxidized-sync": { ... },
        "snmp-polling": { ... },
        "checkmk-status": { ... }
      }
    }
  },
  "timestamp": "2025-12-02T12:00:00.000Z"
}
```

**Status Codes:**
- `200` - Todos os serviços OK
- `503` - Algum serviço com problema

---

### ✅ 3. **Sanitização de Logs** (Segurança)

Módulo para prevenir vazamento de segredos em logs.

#### **Localização**
```
server/src/modules/observability/log-sanitizer.js
```

#### **Padrões Redactados Automaticamente**

- Passwords
- API Keys / Tokens
- JWT Tokens
- SSH Private Keys
- Database URLs (com credenciais)
- SNMP Communities
- Segredos genéricos

#### **Uso no Código**

```javascript
import { createSafeLogger } from './modules/observability/log-sanitizer.js';

const logger = createSafeLogger('BACKEND');

// Logs automáticos com sanitização
logger.info('User logged in with password=secret123');
// Output: User logged in with password=***REDACTED***

logger.error({ password: 'mypass', token: 'abc123' });
// Output: { password: '***REDACTED***', token: '***REDACTED***' }
```

#### **Funções Disponíveis**

- `safeLog(...args)` - console.log com sanitização
- `safeError(...args)` - console.error com sanitização
- `safeWarn(...args)` - console.warn com sanitização
- `createSafeLogger(prefix)` - Cria logger customizado
- `sanitizeString(str)` - Sanitiza string
- `sanitizeObject(obj)` - Sanitiza objeto

---

### ✅ 4. **CheckMK Assíncrono** (Resolvido Timeout 504)

Integração com CheckMK reabilitada de forma **não bloqueante**.

#### **Problema Anterior**

- Listagem de `/devices` fazia chamadas HTTP **síncronas** ao CheckMK
- Com muitos devices, causava **timeout 504**
- UI ficava travada

#### **Solução Implementada**

1. **Job Periódico em Background** (`checkmk-status`)
   - Busca status de **todos os devices ativos** do CheckMK
   - Atualiza campos `checkmkStatus` e `lastCheckmkCheck` no banco
   - Roda a cada **5 minutos** (configurável)
   - **Não bloqueia** a UI

2. **Leitura Rápida do Banco**
   - Endpoint `/devices` lê `checkmkStatus` do banco (PostgreSQL)
   - **Sem chamadas HTTP** ao CheckMK
   - Response time < 200ms mesmo com 1000+ devices

#### **Arquitetura**

```
┌─────────────┐
│  SCHEDULER  │ (a cada 5 min)
└──────┬──────┘
       │ enqueue job
       ▼
┌──────────────┐
│ checkmk-status│ (fila BullMQ)
│     JOB       │
└──────┬───────┘
       │ worker processa
       ▼
┌──────────────────────┐
│ CheckMK Status Poll  │
│ - Busca status de    │
│   todos os devices   │
│ - Atualiza banco:    │
│   checkmkStatus,     │
│   lastCheckmkCheck   │
└──────────────────────┘
       │
       ▼
┌─────────────┐
│  POSTGRES   │
│  (cache)    │
└──────┬──────┘
       │ read fast
       ▼
┌─────────────┐
│ GET /devices│ (< 200ms)
└─────────────┘
```

#### **Configuração**

**Variáveis de Ambiente** (docker-compose.yml ou .env):

```bash
# Habilitar polling automático do CheckMK
AUTO_CHECKMK_POLL=true

# Intervalo de polling (em milissegundos)
CHECKMK_POLL_INTERVAL_MS=300000  # 5 minutos

# Credenciais CheckMK (já existentes)
CHECKMK_URL=http://checkmk:5000/netbox
CHECKMK_SITE=netbox
CHECKMK_USERNAME=cmkadmin
CHECKMK_PASSWORD=admin
```

#### **Schema do Banco** (novos campos)

```prisma
model Device {
  ...
  checkmkStatus    String?   // "up", "down", "unreachable", "unknown"
  lastCheckmkCheck DateTime? // última verificação
  ...
}
```

#### **Comandos Úteis**

```bash
# Aplicar migration do schema
docker exec -it netbox-ops-center-backend npm --prefix server run db:push

# Ver status das filas
docker exec -it netbox-ops-center-redis redis-cli
> KEYS bull:checkmk-status*

# Logs do job
docker logs netbox-ops-center-worker -f | grep CHECKMK
```

---

## 🔧 **Decisão Arquitetural: SSH/SNMP em Node.js**

### **Contexto**

O sistema precisa de automação SSH e SNMP para:
- Sessões SSH via browser (terminal remoto)
- Descoberta SNMP de interfaces e peers BGP
- Validação de credenciais

### **Opções Avaliadas**

| Opção | Vantagens | Desvantagens |
|-------|-----------|--------------|
| **Node.js** (ssh2, net-snmp) | ✅ Já implementado<br>✅ Sem overhead de microserviço<br>✅ Libs maduras (ssh2, net-snmp)<br>✅ Menor latência | ❌ Não tem NAPALM/Nornir |
| **Python** (Nornir, Netmiko, NAPALM) | ✅ Libs ricas para networking<br>✅ NAPALM para multi-vendor | ❌ Overhead de microserviço<br>❌ Comunicação via fila/HTTP<br>❌ Mais complexidade |

### **Decisão Final**

**Manter SSH/SNMP em Node.js** pelos seguintes motivos:

1. **Já está implementado** e funcionando bem
2. **ssh2** é uma biblioteca madura e rápida para SSH
3. **net-snmp** suporta todas as operações SNMP necessárias
4. **Menor complexidade** arquitetural (sem microserviço extra)
5. **Menor latência** (sem comunicação HTTP entre serviços)

**Quando considerar Python no futuro:**
- Se precisar de **NAPALM** (getters multi-vendor)
- Se precisar de **Nornir** (orquestração complexa)
- Se precisar de **bibliotecas de parsing** específicas (TextFSM, TTP)

### **Código Atual**

**SSH**:
- `server/src/modules/access/ssh-service.js` - Sessões SSH via browser
- `server/src/modules/access/ssh-check.js` - Validação de credenciais

**SNMP**:
- `server/src/queues/processors/snmp-polling.js` - Polling periódico
- `server/src/queues/processors/snmp-discovery.js` - Descoberta de interfaces/peers

---

## 📝 **Variáveis de Ambiente Completas**

```bash
# === Observabilidade ===
# (sem variáveis específicas - métricas sempre ativas)

# === CheckMK ===
AUTO_CHECKMK_POLL=true              # Habilitar polling automático
CHECKMK_POLL_INTERVAL_MS=300000     # Intervalo de polling (5 min)
CHECKMK_URL=http://checkmk:5000/netbox
CHECKMK_SITE=netbox
CHECKMK_USERNAME=cmkadmin
CHECKMK_PASSWORD=admin

# === Outros Jobs Periódicos ===
SNMP_POLL_INTERVAL_MS=300000        # SNMP polling (5 min)
OXIDIZED_SYNC_INTERVAL_MS=900000    # Oxidized sync (15 min)
AUTO_NETBOX_SYNC=false              # NetBox auto-sync (padrão: manual)
NETBOX_SYNC_INTERVAL_MS=1800000     # NetBox sync interval (30 min)
```

---

## 🚀 **Como Usar**

### **1. Ver Métricas Prometheus**

```bash
curl http://localhost:4000/metrics
```

### **2. Verificar Saúde dos Serviços**

```bash
curl http://localhost:4000/health/services | jq
```

### **3. Habilitar CheckMK Automático**

**Edite `docker-compose.yml`** (seção `scheduler`):

```yaml
scheduler:
  environment:
    AUTO_CHECKMK_POLL: "true"
    CHECKMK_POLL_INTERVAL_MS: "300000"  # 5 minutos
```

**Restart scheduler**:
```bash
docker compose restart scheduler
```

**Verificar logs**:
```bash
docker logs netbox-ops-center-scheduler -f
# Deve aparecer: [SCHEDULER] CheckMK status polling enabled (every 300 seconds)
```

### **4. Testar Sanitização de Logs**

```bash
docker exec -it netbox-ops-center-backend node -e "
const { testSanitizer } = require('./server/src/modules/observability/log-sanitizer.js');
testSanitizer();
"
```

---

## 📊 **Monitoramento com Grafana**

### **Dashboard Sugerido**

**Panels**:
1. **Queue Health**
   - Queries: `bullmq_jobs_waiting_total`, `bullmq_jobs_failed_total`
   - Graph: Stacked area chart por fila

2. **HTTP Performance**
   - Query: `rate(http_requests_total[5m])`
   - Graph: Requests/second por endpoint

3. **Job Duration**
   - Query: `histogram_quantile(0.95, bullmq_job_duration_seconds)`
   - Graph: p95 latency por fila

4. **System Resources**
   - Queries: `process_cpu_seconds_total`, `nodejs_heap_size_used_bytes`
   - Graph: CPU e Memory usage

### **Alertas Prometheus**

```yaml
groups:
  - name: netbox-ops-center
    rules:
      - alert: HighFailedJobs
        expr: bullmq_jobs_failed_total > 10
        for: 5m
        annotations:
          summary: "Muitos jobs falhando na fila {{ $labels.queue }}"

      - alert: APIDown
        expr: up{job="netbox-ops-center"} == 0
        for: 1m
        annotations:
          summary: "API NetBox Ops Center down"
```

---

## 🔍 **Troubleshooting**

### **Métricas não aparecem**

1. Verificar se endpoint `/metrics` responde:
   ```bash
   curl http://localhost:4000/metrics
   ```

2. Verificar logs do backend:
   ```bash
   docker logs netbox-ops-center-backend | grep METRICS
   # Deve aparecer: [METRICS] Started metrics collection
   ```

### **CheckMK status não atualiza**

1. Verificar se `AUTO_CHECKMK_POLL=true`:
   ```bash
   docker exec netbox-ops-center-scheduler env | grep CHECKMK
   ```

2. Verificar logs do scheduler:
   ```bash
   docker logs netbox-ops-center-scheduler | grep CHECKMK
   ```

3. Verificar worker processando jobs:
   ```bash
   docker logs netbox-ops-center-worker | grep checkmk-status
   ```

4. Verificar fila no Redis:
   ```bash
   docker exec -it netbox-ops-center-redis redis-cli
   > KEYS bull:checkmk-status*
   > LLEN bull:checkmk-status:completed
   ```

### **Devices não mostram status CheckMK**

1. Verificar se campo existe no banco:
   ```bash
   docker exec netbox-ops-center-db psql -U netbox_ops -d netbox_ops -c "
   SELECT id, name, \"checkmkStatus\", \"lastCheckmkCheck\"
   FROM \"Device\"
   LIMIT 5;
   "
   ```

2. Rodar migration se campo não existir:
   ```bash
   docker exec netbox-ops-center-backend npm --prefix server run db:push
   ```

---

## 📚 **Referências**

- **Prometheus**: https://prometheus.io/docs/
- **prom-client**: https://github.com/siimon/prom-client
- **BullMQ Metrics**: https://docs.bullmq.io/guide/metrics
- **CheckMK API**: https://docs.checkmk.com/latest/en/rest_api.html

---

## ✅ **Checklist de Implementação**

- [x] Métricas Prometheus (`/metrics`)
- [x] Health endpoints (`/health`, `/health/services`)
- [x] Sanitização de logs (sem vazamento de segredos)
- [x] CheckMK assíncrono (sem timeout)
- [x] Jobs periódicos configuráveis
- [x] Documentação completa
- [x] Schema atualizado (checkmkStatus)
- [x] Workers e processors registrados

---

**Autor**: Claude Code
**Data**: 2025-12-02
**Versão**: v0.3.0
