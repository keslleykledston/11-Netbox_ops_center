# Guia Rápido: Configurar Token do LibreNMS

Este guia mostra como configurar o token do LibreNMS para permitir que o NetBox Ops Center adicione dispositivos automaticamente.

## 🎯 Problema Identificado

```bash
$ docker exec netbox-ops-center-backend printenv | grep LIBRENMS_TOKEN
(vazio)
```

**Sem o token do LibreNMS, o backend não consegue adicionar dispositivos!**

## ✅ Solução Passo a Passo

### Passo 1: Acessar o LibreNMS

1. Abra seu navegador
2. Acesse: `http://SEU_IP:8009`
3. Login:
   - **Usuário**: `librenms`
   - **Senha**: `librenms`

⚠️ **IMPORTANTE**: Altere a senha padrão após o primeiro acesso!

### Passo 2: Gerar Token da API

1. Clique no **ícone do usuário** (canto superior direito)
2. Vá em **"My Settings"**
3. Clique na aba **"API Settings"**
4. Clique em **"Create API Token"**
5. No campo "Description", digite: `netbox-ops-center-integration`
6. Clique em **"Generate"**
7. **COPIE O TOKEN** que aparecerá na tela

   ⚠️ **Você não poderá ver este token novamente!**

**Exemplo de token:**
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

### Passo 3: Configurar Token no Backend

Edite o arquivo `.env`:

```bash
nano .env
```

**Substitua a linha:**
```env
LIBRENMS_API_TOKEN=COLE_SEU_TOKEN_AQUI
```

**Por:**
```env
LIBRENMS_API_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

Salve o arquivo (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Passo 4: Reiniciar os Containers

```bash
docker compose restart backend worker scheduler
```

### Passo 5: Verificar Configuração

```bash
# Verificar se o token foi carregado
docker exec netbox-ops-center-backend printenv | grep LIBRENMS_API_TOKEN

# Deve mostrar algo como:
LIBRENMS_API_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

### Passo 6: Testar Adição de Dispositivo

#### Opção A: Via Interface Web

1. Acesse seu NetBox Ops Center
2. Vá em **Devices**
3. Edite o dispositivo **4WNET-BVA-BRT-R:X_NE8000-VS1**
4. Marque **"Monitoring Enabled"**
5. Clique em **Save**

#### Opção B: Via API

```bash
# Primeiro, gere seu token de autenticação
./scripts/generate-auth-token.sh seu_email@example.com sua_senha

# Depois, atualize o dispositivo
DEVICE_ID=123  # Substitua pelo ID correto

curl -X PATCH "http://localhost/api/devices/$DEVICE_ID" \
  -H "Authorization: Bearer $(cat ~/.netbox-ops-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "monitoringEnabled": true,
    "snmpVersion": "v2c",
    "snmpCommunity": "4wnetsnmp"
  }'
```

### Passo 7: Monitorar Execução

```bash
# Ver logs do worker em tempo real
docker logs netbox-ops-center-worker -f | grep -i "4WNET"

# Você deve ver:
[LIBRENMS] Adding device 4WNET-BVA-BRT-R:X_NE8000-VS1 (45.169.161.255) to LibreNMS...
[LIBRENMS] SNMP Version: v2c, Community: ***, Port: 161
[LIBRENMS] Normalized payload for 4WNET-BVA-BRT-R:X_NE8000-VS1:
{
  "hostname": "45.169.161.255",
  "display": "4WNET-BVA-BRT-R:X_NE8000-VS1",
  "snmp_version": "v2c",
  "port": 161,
  "transport": "udp",
  "community": "4wnetsnmp",
  "poller_group": "K3G Solutions"
}
[LIBRENMS] ✅ Successfully added device 4WNET-BVA-BRT-R:X_NE8000-VS1 (45.169.161.255)
[QUEUE][librenms-sync] Job librenms-add-123-... completed
```

### Passo 8: Verificar no LibreNMS

1. Acesse o LibreNMS: `http://SEU_IP:8009`
2. Vá em **Devices**
3. Você deve ver **4WNET-BVA-BRT-R:X_NE8000-VS1** na lista

**Via API:**
```bash
# Listar todos os dispositivos
curl -s "http://localhost:8009/api/v0/devices" \
  -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" | \
  jq '.devices[] | {hostname, display, poller_group, status}'

# Buscar dispositivo específico
curl -s "http://localhost:8009/api/v0/devices" \
  -H "X-Auth-Token: SEU_TOKEN_LIBRENMS" | \
  jq '.devices[] | select(.display | contains("4WNET"))'
```

---

## 🔧 Configuração Completa do .env

Seu arquivo `.env` (ou `.env.local` para sobrescritas) deve ter estas configurações:

```env
DATABASE_URL="postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops"

PORT=4000
JWT_SECRET=change_me

NETBOX_URL=https://docs.k3gsolutions.com.br
NETBOX_TOKEN=b16412d4dc73d4d9f820e79461e13b3faa6953ac

# LibreNMS Configuration
LIBRENMS_URL=http://librenms:8000
LIBRENMS_API_TOKEN=SEU_TOKEN_AQUI
LIBRENMS_SNMP_COMMUNITY=public
LIBRENMS_POLL_INTERVAL_MS=300000
AUTO_LIBRENMS_POLL=true

CRED_ENCRYPTION_KEY=LhDsL30g5Nz35Yc0vk4xZO1bohsBS562
```

---

## 🐛 Problema Secundário: SNMP Polling Falhando

Você também tem este problema nos logs:

```
[SNMP-POLL] Failed: connect ECONNREFUSED 127.0.0.1:3001
```

### Causa

O código de SNMP polling está tentando conectar em `localhost:3001` que não existe. Isso era provavelmente usado com uma API SNMP externa que foi removida.

### Solução

O polling de SNMP agora deve ser feito pelo **LibreNMS**, não pelo NetBox Ops Center. Para desabilitar o SNMP polling interno:

```bash
# Editar scheduler
nano server/src/scheduler.js

# Encontre a linha:
timers.push(interval(scheduleSnmpPolling, SNMP_POLL_INTERVAL_MS));

# Comente ou remova essa linha
```

Ou adicione no `.env`:

```env
SNMP_POLL_INTERVAL_MS=0  # Desabilita SNMP polling interno
```

---

## ✅ Checklist de Verificação

- [ ] Token do LibreNMS gerado
- [ ] Token configurado no `.env` (linha `LIBRENMS_API_TOKEN`)
- [ ] Containers reiniciados (`docker compose restart backend worker scheduler`)
- [ ] Token carregado no backend (verificado com `printenv | grep LIBRENMS_API_TOKEN`)
- [ ] Dispositivo com `monitoringEnabled: true` e SNMP configurado
- [ ] Logs do worker mostram adição bem-sucedida
- [ ] Dispositivo aparece no LibreNMS

---

## 📚 Scripts Úteis

### Gerar Token de Autenticação

```bash
./scripts/generate-auth-token.sh seu_email@example.com sua_senha
```

### Monitorar Filas

```bash
# Visão geral
./scripts/monitor-queues.sh overview

# Status de um dispositivo
./scripts/monitor-queues.sh device "4WNET-BVA-BRT"

# Logs do LibreNMS
./scripts/monitor-queues.sh logs worker
```

---

## 🆘 Troubleshooting

### Erro: "LibreNMS not configured"

**Causa:** Token não foi carregado no backend.

**Solução:**
```bash
# Verificar
docker exec netbox-ops-center-backend printenv | grep LIBRENMS_API_TOKEN

# Se vazio, edite .env e reinicie
docker compose restart backend worker scheduler
```

### Erro: "SNMP timeout"

**Causa:** SNMP community incorreta ou firewall bloqueando.

**Solução:**
```bash
# Testar SNMP manualmente
docker exec netbox-ops-center-librenms snmpwalk -v2c -c 4wnetsnmp 45.169.161.255 sysDescr.0

# Se funcionar, o problema é na configuração do dispositivo no NetBox Ops Center
```

### Dispositivo Não Aparece no LibreNMS

**Verificar:**

1. Token configurado?
2. Job foi executado? (ver logs do worker)
3. Job falhou? (ver `./scripts/monitor-queues.sh jobs librenms-sync failed`)
4. SNMP funciona? (testar manualmente)
5. Dispositivo está marcado como "disabled" no LibreNMS?

---

## 📞 Suporte

Se continuar com problemas:

1. Execute: `./scripts/monitor-queues.sh device "4WNET-BVA-BRT"`
2. Copie os logs: `docker logs netbox-ops-center-worker --tail 100 | grep -i librenms`
3. Abra uma issue no GitHub com os logs
