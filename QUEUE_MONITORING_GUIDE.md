# Guia de Monitoramento de Filas

Este guia explica como monitorar as filas de jobs do NetBox Ops Center, incluindo tarefas de sincronização com LibreNMS.

## Índice

1. [Visão Geral das Filas](#visão-geral-das-filas)
2. [Endpoints da API](#endpoints-da-api)
3. [Monitoramento via Terminal](#monitoramento-via-terminal)
4. [Debugging de Jobs Específicos](#debugging-de-jobs-específicos)
5. [Troubleshooting](#troubleshooting)

## Visão Geral das Filas

O NetBox Ops Center utiliza **BullMQ** (baseado em Redis) para processar jobs assíncronos. As filas disponíveis são:

| Fila | Descrição | Concorrência |
|------|-----------|--------------|
| `netbox-sync` | Sincronização com NetBox | 2 |
| `oxidized-sync` | Sincronização com Oxidized | 1 |
| `snmp-discovery` | Descoberta SNMP (interfaces, peers) | 4 |
| `snmp-polling` | Polling SNMP periódico | 6 |
| `device-scan` | Scan de dispositivos | 4 |
| `credential-check` | Validação de credenciais | 2 |
| `connectivity-test` | Teste de conectividade | 4 |
| `ssh-session` | Sessões SSH | - |
| `librenms-sync` | Sincronização com LibreNMS | 2 |
| `librenms-status` | Polling de status do LibreNMS | 1 |

### Estados dos Jobs

- **waiting**: Aguardando processamento
- **active**: Sendo processado no momento
- **completed**: Concluído com sucesso
- **failed**: Falhou (será retentado até 3x por padrão)
- **delayed**: Agendado para execução futura

## Endpoints da API

### 1. Overview de Todas as Filas

```bash
curl http://localhost/api/queues/overview \
  -H "Authorization: Bearer SEU_TOKEN"
```

**Resposta**:
```json
{
  "queues": [
    {
      "name": "librenms-sync",
      "waiting": 0,
      "active": 1,
      "completed": 45,
      "failed": 2,
      "delayed": 0,
      "total": 48
    },
    {
      "name": "librenms-status",
      "waiting": 0,
      "active": 0,
      "completed": 120,
      "failed": 0,
      "delayed": 0,
      "total": 120
    }
  ]
}
```

### 2. Jobs de uma Fila Específica

```bash
# Listar jobs ativos
curl "http://localhost/api/queues/librenms-sync/jobs?status=active&start=0&end=10" \
  -H "Authorization: Bearer SEU_TOKEN"

# Listar jobs completados
curl "http://localhost/api/queues/librenms-sync/jobs?status=completed&start=0&end=10" \
  -H "Authorization: Bearer SEU_TOKEN"

# Listar jobs falhos
curl "http://localhost/api/queues/librenms-sync/jobs?status=failed&start=0&end=10" \
  -H "Authorization: Bearer SEU_TOKEN"
```

**Resposta**:
```json
[
  {
    "id": "librenms-add-123-1764671099169",
    "name": "sync",
    "data": {
      "action": "add",
      "deviceId": 123,
      "device": {
        "id": 123,
        "name": "router-01",
        "ipAddress": "192.168.1.1",
        "snmpVersion": "v2c",
        "snmpCommunity": "public"
      },
      "userId": "user@example.com",
      "startedAt": "2025-01-10T10:30:00Z"
    },
    "progress": 100,
    "returnValue": {
      "success": true,
      "deviceId": 456,
      "libreNmsId": 456
    },
    "attemptsMade": 1,
    "processedOn": 1764671100000,
    "finishedOn": 1764671105000,
    "timestamp": 1764671099169,
    "failedReason": null,
    "state": "completed"
  }
]
```

### 3. Detalhes de um Job Específico

```bash
curl "http://localhost/api/queues/librenms-sync/jobs/librenms-add-123-1764671099169" \
  -H "Authorization: Bearer SEU_TOKEN"
```

## Monitoramento via Terminal

### 1. Verificar Overview das Filas

```bash
# Via curl formatado
curl -s http://localhost/api/queues/overview \
  -H "Authorization: Bearer $(cat ~/.netbox-ops-token)" | jq

# Via script rápido
docker exec netbox-ops-center-backend node -e "
const { getAllQueues } = require('./server/src/queues/index.js');
const queueMap = getAllQueues();
for (const [name, queue] of queueMap.entries()) {
  Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount()
  ]).then(([w, a, c, f]) => {
    console.log(\`\${name.padEnd(20)} W:\${w} A:\${a} C:\${c} F:\${f}\`);
  });
}
"
```

### 2. Monitorar Jobs do LibreNMS

```bash
# Jobs aguardando
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=waiting" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, action: .data.action, device: .data.device.name}'

# Jobs ativos
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=active" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, progress, device: .data.device.name}'

# Jobs completados (últimos 10)
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=completed&start=0&end=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, device: .data.device.name, success: .returnValue.success}'

# Jobs falhos
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=failed" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, device: .data.device.name, error: .failedReason}'
```

### 3. Logs dos Workers

```bash
# Logs do worker (processa os jobs)
docker logs netbox-ops-center-worker --tail 50 -f

# Filtrar apenas LibreNMS
docker logs netbox-ops-center-worker -f | grep -i librenms

# Logs do scheduler (agenda jobs periódicos)
docker logs netbox-ops-center-scheduler --tail 50 -f

# Filtrar apenas LibreNMS
docker logs netbox-ops-center-scheduler -f | grep -i librenms
```

### 4. Logs Detalhados de um Dispositivo

Quando você ativa monitoramento em um dispositivo, os logs mostram:

```bash
# Logs do backend (quando o dispositivo é salvo)
docker logs netbox-ops-center-backend -f | grep -i "4WNET-BVA-BRT"

# Você deve ver:
[LIBRENMS][WARN] Enqueued LibreNMS sync job librenms-add-123-1764671099169
```

```bash
# Logs do worker (quando o job é processado)
docker logs netbox-ops-center-worker -f | grep -i "4WNET-BVA-BRT"

# Você deve ver:
[LIBRENMS] Adding device 4WNET-BVA-BRT-R:X_NE8000-VS1 (10.x.x.x) to LibreNMS...
[LIBRENMS] SNMP Version: v2c, Community: ***, Port: 161
[LIBRENMS] Normalized payload for 4WNET-BVA-BRT-R:X_NE8000-VS1: {...}
[LIBRENMS] ✅ Successfully added device 4WNET-BVA-BRT-R:X_NE8000-VS1
[QUEUE][librenms-sync] Job librenms-add-123-... completed
```

## Debugging de Jobs Específicos

### Exemplo Prático: Debugar Dispositivo que Não Aparece no LibreNMS

**Cenário**: Você ativou `monitoringEnabled` no dispositivo "4WNET-BVA-BRT-R:X_NE8000-VS1" mas ele não aparece no LibreNMS.

#### Passo 1: Verificar se o Job Foi Criado

```bash
# Obter ID do dispositivo (substitua pelo nome correto)
DEVICE_ID=$(curl -s "http://localhost/api/devices" -H "Authorization: Bearer $TOKEN" | \
  jq -r '.[] | select(.name=="4WNET-BVA-BRT-R:X_NE8000-VS1") | .id')

echo "Device ID: $DEVICE_ID"

# Buscar jobs relacionados a esse dispositivo
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=completed&start=0&end=50" \
  -H "Authorization: Bearer $TOKEN" | \
  jq ".[] | select(.data.deviceId == $DEVICE_ID)"
```

#### Passo 2: Verificar Logs do Backend

```bash
# Verificar se o job foi enfileirado
docker logs netbox-ops-center-backend --tail 200 | grep -i "librenms.*$DEVICE_ID"
```

**O que procurar:**
```
[LIBRENMS][WARN] Enqueued LibreNMS sync job librenms-add-123-...
```

Se não aparecer, o problema está no backend (endpoint de devices).

#### Passo 3: Verificar Logs do Worker

```bash
# Verificar se o job foi processado
docker logs netbox-ops-center-worker --tail 200 | grep -i "librenms.*$DEVICE_ID"
```

**O que procurar:**
```
[LIBRENMS] Adding device 4WNET-BVA-BRT-R:X_NE8000-VS1 (10.x.x.x) to LibreNMS...
[LIBRENMS] SNMP Version: v2c, Community: ***, Port: 161
[LIBRENMS] Normalized payload: {...}
[LIBRENMS] ✅ Successfully added device
```

**Se aparecer erro:**
```
[LIBRENMS] ❌ Failed to add device: LibreNMS HTTP 422: SNMP timeout
```

#### Passo 4: Verificar Configurações SNMP

```bash
# Testar SNMP do host (fora do container)
snmpwalk -v2c -c 4wnetsnmp 10.x.x.x system

# Testar SNMP do container LibreNMS
docker exec netbox-ops-center-librenms snmpwalk -v2c -c 4wnetsnmp 10.x.x.x system
```

**Erros comuns:**
- `Timeout: No Response from 10.x.x.x`: SNMP community incorreta ou firewall bloqueando
- `No Such Object available`: OID não existe (dispositivo não suporta SNMP padrão)

#### Passo 5: Verificar no LibreNMS

```bash
# Verificar se o dispositivo existe no LibreNMS
curl -s http://localhost:8009/api/v0/devices \
  -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" | \
  jq '.devices[] | select(.hostname | contains("4WNET"))'
```

#### Passo 6: Verificar Job Falho

```bash
# Listar jobs falhos
curl -s "http://localhost/api/queues/librenms-sync/jobs?status=failed" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Analisar o erro:**
```json
{
  "id": "librenms-add-123-...",
  "failedReason": "LibreNMS HTTP 422: SNMP timeout",
  "attemptsMade": 3,
  "data": {
    "device": {
      "name": "4WNET-BVA-BRT-R:X_NE8000-VS1",
      "ipAddress": "10.x.x.x",
      "snmpCommunity": "4wnetsnmp"
    }
  }
}
```

## Troubleshooting

### Problema 1: Job Não Foi Criado

**Sintomas:**
- Dispositivo salvo com `monitoringEnabled: true`
- Nenhum job aparece na fila `librenms-sync`

**Verificações:**
```bash
# 1. Verificar se o campo monitoringEnabled foi salvo
curl -s "http://localhost/api/devices/$DEVICE_ID" -H "Authorization: Bearer $TOKEN" | \
  jq '{id, name, monitoringEnabled, libreNmsId, libreNmsStatus}'

# 2. Verificar logs do backend
docker logs netbox-ops-center-backend --tail 100 | grep -i "librenms"

# 3. Verificar função enqueueLibreNmsSync
docker exec netbox-ops-center-backend grep -A 10 "enqueueLibreNmsSync" /app/server/src/index.js
```

**Solução:**
- Certifique-se que o campo `monitoringEnabled: true` foi enviado no PATCH/POST
- Reinicie o backend: `docker compose restart backend`

### Problema 2: Job Criado Mas Não Processado

**Sintomas:**
- Job aparece como `waiting` indefinidamente
- Nunca muda para `active` ou `completed`

**Verificações:**
```bash
# 1. Verificar se o worker está rodando
docker compose ps | grep worker

# 2. Verificar logs do worker
docker logs netbox-ops-center-worker --tail 50

# 3. Verificar Redis
docker exec netbox-ops-center-redis redis-cli PING
```

**Solução:**
- Reinicie o worker: `docker compose restart worker`
- Limpe a fila: `docker exec netbox-ops-center-redis redis-cli DEL bull:librenms-sync:waiting`

### Problema 3: Job Falha com "LibreNMS not configured"

**Sintomas:**
```
{
  "skipped": true,
  "reason": "LIBRENMS_URL/API_TOKEN not configured"
}
```

**Solução:**
```bash
# Verificar variáveis de ambiente
docker exec netbox-ops-center-backend printenv | grep LIBRENMS

# Se não estiverem configuradas, edite .env:
cd server
nano .env

# Adicione:
LIBRENMS_URL=http://librenms:8000
LIBRENMS_TOKEN=seu_token_aqui

# Reinicie
docker compose restart backend worker scheduler
```

### Problema 4: Job Falha com "SNMP timeout"

**Sintomas:**
```
[LIBRENMS] ❌ Failed to add device: LibreNMS HTTP 422: SNMP timeout
```

**Verificações:**
```bash
# 1. Testar SNMP manualmente
docker exec netbox-ops-center-librenms snmpget -v2c -c 4wnetsnmp 10.x.x.x sysDescr.0

# 2. Verificar se LibreNMS consegue alcançar o dispositivo
docker exec netbox-ops-center-librenms ping -c 3 10.x.x.x

# 3. Verificar se a SNMP community está correta no dispositivo
curl -s "http://localhost/api/devices/$DEVICE_ID" -H "Authorization: Bearer $TOKEN" | \
  jq '{name, ipAddress, snmpVersion, snmpCommunity, snmpPort}'
```

**Soluções:**
- Verifique se a SNMP community está correta
- Verifique se o firewall permite SNMP (porta 161 UDP)
- Verifique se o dispositivo está acessível pela rede do container

### Problema 5: Dispositivo Adicionado Mas Não Aparece no LibreNMS

**Sintomas:**
- Job completa com sucesso
- `libreNmsId` é salvo no banco de dados
- Dispositivo não aparece na interface do LibreNMS

**Verificações:**
```bash
# 1. Verificar se o device_id realmente existe no LibreNMS
LIBRENMS_ID=$(curl -s "http://localhost/api/devices/$DEVICE_ID" -H "Authorization: Bearer $TOKEN" | jq -r '.libreNmsId')

curl -s "http://localhost:8009/api/v0/devices/$LIBRENMS_ID" \
  -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" | jq

# 2. Verificar se o dispositivo está marcado como "disabled"
curl -s "http://localhost:8009/api/v0/devices" \
  -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" | \
  jq ".devices[] | select(.device_id == $LIBRENMS_ID) | {device_id, hostname, disabled, status}"
```

**Solução:**
- Se `disabled: 1`, habilite no LibreNMS:
  ```bash
  curl -X PATCH "http://localhost:8009/api/v0/devices/$LIBRENMS_ID" \
    -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" \
    -H "Content-Type: application/json" \
    -d '{"field": "disabled", "value": "0"}'
  ```

## Referências

- [Documentação do BullMQ](https://docs.bullmq.io/)
- [API do LibreNMS](https://docs.librenms.org/API/)
- [Guia de Setup do LibreNMS](LIBRENMS_SETUP_GUIDE.md)
