# Guia de Setup do LibreNMS + Grafana

Este guia fornece instruções completas para configurar e integrar o LibreNMS com o NetBox Ops Center.

## Índice

1. [Visão Geral](#visão-geral)
2. [Primeiro Acesso ao LibreNMS](#primeiro-acesso-ao-librenms)
3. [Configuração do LibreNMS](#configuração-do-librenms)
4. [Geração do Token da API](#geração-do-token-da-api)
5. [Configuração do Grafana](#configuração-do-grafana)
6. [Dashboards Recomendados](#dashboards-recomendados)
7. [Integração com NetBox Ops Center](#integração-com-netbox-ops-center)
8. [Verificação e Troubleshooting](#verificação-e-troubleshooting)

## Visão Geral

O LibreNMS é uma plataforma completa de monitoramento de rede que fornece:

- **Monitoramento SNMP**: Coleta de métricas de dispositivos de rede
- **Detecção automática**: Descoberta de interfaces, BGP peers, etc.
- **Alertas**: Sistema de notificação configurável
- **API REST**: Integração programática com outros sistemas
- **Grafana**: Visualização avançada de métricas

### Arquitetura

```
┌─────────────────────┐     ┌─────────────────────┐
│  NetBox Ops Center  │────▶│     LibreNMS        │
│   (Backend API)     │     │  (Monitoramento)    │
└─────────────────────┘     └─────────────────────┘
         │                            │
         │                            ▼
         │                   ┌─────────────────────┐
         │                   │      Grafana        │
         │                   │  (Visualização)     │
         │                   └─────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Redis + BullMQ    │
│   (Job Queue)       │
└─────────────────────┘
```

## Primeiro Acesso ao LibreNMS

### 1. Iniciar os containers

```bash
cd /path/to/netbox-ops-center
docker compose up -d
```

Verifique que todos os containers estão rodando:

```bash
docker compose ps
```

Você deve ver:
- `netbox-ops-center-librenms`
- `netbox-ops-center-librenms-db`
- `netbox-ops-center-librenms-redis`
- `netbox-ops-center-grafana`

### 2. Acessar a interface web

Abra seu navegador e acesse:

```
http://SEU_IP:8000
```

**Credenciais padrão**:
- **Usuário**: `librenms`
- **Senha**: `librenms`

⚠️ **IMPORTANTE**: Altere a senha padrão imediatamente após o primeiro login!

### 3. Alterar senha do administrador

1. Faça login com as credenciais padrão
2. Clique no menu do usuário (canto superior direito)
3. Vá em **My Settings**
4. Na aba **Change Password**, defina uma senha forte
5. Clique em **Save**

## Configuração do LibreNMS

### Configurações Básicas

1. **Configurar SNMP Community (se necessário)**

   Vá em **Settings** → **Global Settings** → **SNMP**:
   - Defina a community string padrão (ex: `public` para leitura)
   - Configure SNMPv3 se necessário

2. **Configurar polling interval**

   O intervalo de polling padrão é 5 minutos. Para ajustar:
   - Vá em **Settings** → **Poller** → **Poller Settings**
   - Ajuste o `Poller Interval` conforme necessário

3. **Habilitar descoberta automática (opcional)**

   Para descobrir dispositivos automaticamente na rede:
   - Vá em **Settings** → **Discovery**
   - Configure as redes para descoberta (ex: `192.168.1.0/24`)
   - Configure a SNMP community a ser usada

### Configuração de Alertas (Opcional)

1. Vá em **Alerts** → **Alert Rules**
2. Crie regras para notificações (ex: Device Down, High CPU, etc.)
3. Configure transports (email, Slack, etc.) em **Alerts** → **Alert Transports**

## Geração do Token da API

Para permitir que o NetBox Ops Center sincronize dispositivos automaticamente com o LibreNMS:

### 1. Acessar configurações de API

1. Faça login no LibreNMS
2. Clique no ícone do usuário (canto superior direito)
3. Vá em **My Settings**
4. Clique na aba **API Settings**

### 2. Criar um novo token

1. Clique em **Create API Token**
2. Digite uma descrição (ex: `netbox-ops-center-integration`)
3. Clique em **Generate**
4. **Copie o token gerado** (você não poderá vê-lo novamente!)

### 3. Configurar no NetBox Ops Center

Edite o arquivo `.env` do backend:

```bash
cd server
nano .env
```

Adicione ou atualize as seguintes variáveis:

```bash
# LibreNMS Configuration
LIBRENMS_URL=http://netbox-ops-center-librenms:8000
LIBRENMS_TOKEN=SEU_TOKEN_AQUI
LIBRENMS_SNMP_COMMUNITY=public

# LibreNMS Polling Configuration
LIBRENMS_POLL_INTERVAL_MS=300000  # 5 minutos
AUTO_LIBRENMS_POLL=true
```

**Salve** e reinicie os containers:

```bash
docker compose restart netbox-ops-center-app
docker compose restart netbox-ops-center-scheduler
```

## Configuração do Grafana

### 1. Primeiro acesso ao Grafana

Abra seu navegador e acesse:

```
http://SEU_IP:3033
```

**Credenciais padrão**:
- **Usuário**: `admin`
- **Senha**: `admin`

Você será solicitado a alterar a senha no primeiro login.

### 2. Adicionar LibreNMS como Data Source

1. No menu lateral, vá em **Configuration** → **Data Sources**
2. Clique em **Add data source**
3. Selecione **MySQL**
4. Configure:
   - **Name**: `LibreNMS`
   - **Host**: `netbox-ops-center-librenms-db:3306`
   - **Database**: `librenms`
   - **User**: `librenms`
   - **Password**: `librenms` (conforme definido no docker-compose.yml)
   - **TLS/SSL Mode**: Disable
5. Clique em **Save & Test**

Você deve ver: ✅ "Database Connection OK"

### 3. Importar Dashboards

O LibreNMS possui dashboards oficiais para Grafana. Para importar:

1. Vá em **Dashboards** → **Import**
2. Acesse [LibreNMS Grafana Dashboards](https://github.com/librenms/librenms/tree/master/misc/grafana)
3. Copie o conteúdo de um dashboard JSON
4. Cole no campo **Import via panel json**
5. Selecione o datasource `LibreNMS`
6. Clique em **Import**

**Dashboards recomendados**:
- **Device Overview**: Visão geral de um dispositivo específico
- **Port Statistics**: Estatísticas de portas/interfaces
- **Network Traffic**: Tráfego agregado da rede
- **Device Availability**: Status de disponibilidade dos dispositivos

### 4. Dashboard Customizado (Opcional)

Crie um dashboard personalizado para o NetBox Ops Center:

1. Vá em **Dashboards** → **New Dashboard**
2. Clique em **Add new panel**
3. Selecione o datasource `LibreNMS`
4. Use queries SQL personalizadas:

**Exemplo: Devices Up/Down**

```sql
SELECT
  COUNT(CASE WHEN status = 1 THEN 1 END) as up,
  COUNT(CASE WHEN status = 0 THEN 1 END) as down
FROM devices
WHERE disabled = 0
```

**Exemplo: Top 10 Devices by Traffic**

```sql
SELECT
  d.hostname,
  SUM(p.ifInOctets_rate * 8) / 1000000 as traffic_mbps
FROM devices d
JOIN ports p ON d.device_id = p.device_id
WHERE p.deleted = 0
GROUP BY d.hostname
ORDER BY traffic_mbps DESC
LIMIT 10
```

## Dashboards Recomendados

### 1. Device Overview Dashboard

```json
{
  "title": "NetBox Ops Center - Device Overview",
  "panels": [
    {
      "title": "Device Status",
      "type": "stat",
      "targets": [
        {
          "rawSql": "SELECT COUNT(*) as total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up FROM devices WHERE disabled = 0"
        }
      ]
    }
  ]
}
```

### 2. Network Performance Dashboard

Monitore métricas de performance em tempo real:
- Latência média
- Perda de pacotes
- Utilização de banda
- Top talkers

### 3. BGP Monitoring Dashboard

Para monitoramento de peers BGP:
- Estados de sessão BGP
- Prefixos recebidos/anunciados
- Uptime das sessões

## Integração com NetBox Ops Center

### Como funciona a integração

1. **Adição automática de dispositivos**:
   - Ao criar um dispositivo no NetBox Ops Center com `monitoringEnabled: true`
   - O backend enfileira um job `librenms-sync` com ação `add`
   - O worker processa o job e adiciona o dispositivo ao LibreNMS via API
   - O `libreNmsId` é salvo no banco de dados

2. **Atualização automática**:
   - Ao atualizar campos relevantes (IP, hostname, SNMP, etc.)
   - Um job de sync é enfileirado com ação `update`
   - O dispositivo é atualizado no LibreNMS

3. **Polling de status**:
   - A cada 5 minutos (configurável), o scheduler executa `librenms-status`
   - O worker busca status de todos os dispositivos monitorados em batch
   - O status é atualizado no banco de dados (campo `libreNmsStatus`)
   - A UI exibe o status sem fazer chamadas HTTP síncronas

4. **Remoção automática**:
   - Ao deletar um dispositivo, um job `delete` é enfileirado
   - O dispositivo é removido do LibreNMS antes da exclusão do banco

### Testando a integração

1. **Criar um dispositivo de teste**:

   Via API do NetBox Ops Center:

   ```bash
   curl -X POST http://localhost:8080/devices \
     -H "Authorization: Bearer SEU_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "router-test",
       "ipAddress": "192.168.1.1",
       "manufacturer": "Cisco",
       "model": "ISR4331",
       "deviceType": "router",
       "snmpVersion": "v2c",
       "snmpCommunity": "public",
       "monitoringEnabled": true
     }'
   ```

2. **Verificar logs do backend**:

   ```bash
   docker logs netbox-ops-center-app --tail 50 -f
   ```

   Você deve ver:
   ```
   [LIBRENMS][WARN] Enqueued LibreNMS sync job librenms-add-{id}-{timestamp}
   ```

3. **Verificar logs do worker**:

   ```bash
   docker logs netbox-ops-center-worker --tail 50 -f
   ```

   Você deve ver:
   ```
   [QUEUE][librenms-sync] Job librenms-add-{id}-{timestamp} completed
   ```

4. **Verificar no LibreNMS**:

   - Acesse http://SEU_IP:8000
   - Vá em **Devices**
   - O dispositivo `router-test` deve aparecer na lista

5. **Verificar status no NetBox Ops Center**:

   ```bash
   curl http://localhost:8080/devices \
     -H "Authorization: Bearer SEU_TOKEN"
   ```

   O dispositivo deve ter:
   ```json
   {
     "id": 1,
     "name": "router-test",
     "libreNmsId": 123,
     "libreNmsStatus": "down",
     "lastLibreNmsCheck": "2025-01-10T10:30:00Z"
   }
   ```

## Verificação e Troubleshooting

### Verificar conectividade entre containers

```bash
# Entrar no container do backend
docker exec -it netbox-ops-center-app sh

# Testar conectividade com LibreNMS
wget -O- http://netbox-ops-center-librenms:8000/api/v0/devices

# Deve retornar JSON com lista de dispositivos (ou erro 401 se sem token)
```

### Verificar logs do LibreNMS

```bash
docker logs netbox-ops-center-librenms --tail 100 -f
```

### Verificar jobs da fila

Acesse a UI do NetBox Ops Center em **Admin** → **Queue Jobs** ou via API:

```bash
curl http://localhost:8080/queues/librenms-sync/jobs?status=completed \
  -H "Authorization: Bearer SEU_TOKEN"
```

### Problemas comuns

#### 1. Erro "LibreNMS not configured"

**Causa**: Variáveis de ambiente `LIBRENMS_URL` ou `LIBRENMS_TOKEN` não configuradas.

**Solução**:
- Verifique o arquivo `.env`
- Reinicie os containers

#### 2. Erro "Device already exists"

**Causa**: O dispositivo já foi adicionado ao LibreNMS manualmente.

**Solução**:
- O job de sync detecta isso e apenas atualiza o `libreNmsId` no banco
- Nenhuma ação necessária

#### 3. Status sempre "unknown"

**Causa**: Polling de status não está funcionando.

**Solução**:
- Verifique se `AUTO_LIBRENMS_POLL=true` no `.env`
- Verifique logs do scheduler:
  ```bash
  docker logs netbox-ops-center-scheduler --tail 50 -f
  ```
- Verifique se o dispositivo tem `libreNmsId` preenchido

#### 4. Grafana não consegue conectar ao MySQL

**Causa**: Container do MySQL não está acessível ou credenciais incorretas.

**Solução**:
- Verifique se o container `netbox-ops-center-librenms-db` está rodando
- Use o hostname interno: `netbox-ops-center-librenms-db` (não `localhost`)
- Verifique credenciais no docker-compose.yml

### Comandos úteis de diagnóstico

```bash
# Verificar todos os containers
docker compose ps

# Ver logs de todos os containers
docker compose logs -f

# Ver logs específicos do LibreNMS
docker logs netbox-ops-center-librenms -f

# Ver logs do scheduler
docker logs netbox-ops-center-scheduler -f

# Verificar jobs na fila Redis
docker exec -it netbox-ops-center-redis redis-cli
> KEYS bull:librenms-*
> LLEN bull:librenms-sync:waiting

# Limpar fila (se necessário)
> DEL bull:librenms-sync:waiting
> DEL bull:librenms-status:waiting

# Reiniciar apenas o LibreNMS
docker compose restart netbox-ops-center-librenms
```

## Próximos Passos

1. **Configure alertas no LibreNMS** para notificações proativas
2. **Crie dashboards customizados no Grafana** para métricas específicas da sua rede
3. **Habilite discovery automática** para descobrir novos dispositivos
4. **Configure backup do LibreNMS** para preservar configurações e histórico
5. **Explore plugins do LibreNMS** para funcionalidades adicionais

## Referências

- [Documentação oficial do LibreNMS](https://docs.librenms.org/)
- [API do LibreNMS](https://docs.librenms.org/API/)
- [Grafana Dashboards para LibreNMS](https://github.com/librenms/librenms/tree/master/misc/grafana)
- [Documentação do Grafana](https://grafana.com/docs/)

## Suporte

Para problemas ou dúvidas:
1. Verifique os logs dos containers
2. Consulte a seção de Troubleshooting acima
3. Abra uma issue no repositório do projeto
