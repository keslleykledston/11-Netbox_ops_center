# 🔍 Análise de Alternativas de Monitoramento

**Data**: 2025-12-02
**Contexto**: Avaliar alternativas ao CheckMK para monitoramento de dispositivos de rede

---

## 📊 **Comparativo de Soluções**

| Característica | **CheckMK** | **LibreNMS** | **Prometheus + Grafana** | **Zabbix** |
|----------------|-------------|--------------|--------------------------|------------|
| **Tipo** | APM completo | NMS tradicional | Metrics collector + Viz | APM completo |
| **Foco** | Infraestrutura geral | **Networking** | Time-series metrics | Infraestrutura geral |
| **API REST** | ✅ Ótima | ✅ **Excelente** | ✅ Prometheus API | ✅ Boa |
| **Auto-discovery** | ✅ Sim | ✅ **Sim (SNMP/LLDP)** | ❌ Precisa config | ✅ Sim |
| **SNMP Support** | ✅ Bom | ✅ **Excelente** | ⚠️ Via exporters | ✅ Bom |
| **Network Focus** | ⚠️ Genérico | ✅ **Especializado** | ⚠️ Genérico | ⚠️ Genérico |
| **Grafana Integration** | ⚠️ Possível | ✅ **Nativo** | ✅ **Nativo** | ✅ Via datasource |
| **Resource Usage** | 🟡 Médio | 🟢 **Baixo** | 🟢 Baixo | 🔴 Alto |
| **Learning Curve** | 🟡 Médio | 🟢 **Fácil** | 🟡 Médio | 🔴 Alto |
| **Docker Support** | ✅ Oficial | ✅ **Oficial** | ✅ Oficial | ✅ Oficial |
| **Multi-Vendor** | ✅ Sim | ✅ **Excelente** | ⚠️ Depende | ✅ Sim |
| **Alerts** | ✅ Avançado | ✅ **Bom** | ✅ Alertmanager | ✅ Avançado |
| **Network Maps** | ⚠️ Básico | ✅ **Excelente** | ❌ Não | ⚠️ Básico |
| **BGP Monitoring** | ❌ Não | ✅ **Sim** | ⚠️ Via exporter | ⚠️ Limitado |

---

## 🏆 **Recomendação: LibreNMS**

### **Por que LibreNMS é a melhor escolha para este projeto?**

#### **1. Foco em Networking** 🎯
- **Especializado** em monitoramento de dispositivos de rede
- Suporte nativo para:
  - BGP peers (que você já coleta via SNMP)
  - OSPF, ISIS, MPLS
  - VLANs, trunks, port channels
  - Cisco, MikroTik, Huawei, Juniper, etc.

#### **2. Integração Perfeita com seu Stack** 🔗
- **Auto-discovery SNMP**: Descobre dispositivos automaticamente
- **API REST moderna**: Fácil integração com Node.js
- **Grafana nativo**: Dashboards customizados
- **PostgreSQL**: Mesma stack de banco que você já usa

#### **3. Menor Overhead** ⚡
- **Mais leve** que CheckMK
- Melhor performance com muitos devices
- Baixo consumo de CPU/RAM

#### **4. Comunidade Ativa** 👥
- Open source (GPL v3)
- Comunidade forte e ativa
- Documentação excelente
- Muitos plugins e integrações

---

## 🚀 **Arquitetura Proposta: LibreNMS + Grafana**

```
┌──────────────────────────────────────────────────────────┐
│                  NETBOX OPS CENTER                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ Frontend │   │ Backend  │   │  Worker  │           │
│  │  React   │◄──┤ Node.js  │◄──┤  BullMQ  │           │
│  └──────────┘   └────┬─────┘   └──────────┘           │
│                      │                                  │
│                      │ API calls                        │
│                      ▼                                  │
│           ┌──────────────────┐                         │
│           │   PostgreSQL     │                         │
│           │  (devices, etc)  │                         │
│           └──────────────────┘                         │
└──────────────────────────────────────────────────────────┘
                      │
                      │ Sync devices via API
                      ▼
┌──────────────────────────────────────────────────────────┐
│                      LIBRENMS                            │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐       │
│  │  LibreNMS Core                               │       │
│  │  - SNMP Poller (multi-threaded)             │       │
│  │  - Auto-discovery                            │       │
│  │  - Alerting engine                           │       │
│  │  - REST API                                  │       │
│  └──────────────────────────────────────────────┘       │
│           │                                             │
│           ▼                                             │
│  ┌──────────────────┐   ┌──────────────────┐          │
│  │  MySQL/MariaDB   │   │  RRD/Graphite    │          │
│  │  (metadata)      │   │  (time-series)   │          │
│  └──────────────────┘   └──────────────────┘          │
└──────────────────────────────────────────────────────────┘
                      │
                      │ Metrics
                      ▼
┌──────────────────────────────────────────────────────────┐
│                      GRAFANA                             │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐       │
│  │  Dashboards:                                 │       │
│  │  - Network overview                          │       │
│  │  - BGP peers status                          │       │
│  │  - Interface utilization                     │       │
│  │  - Device availability                       │       │
│  │  - Alerts timeline                           │       │
│  └──────────────────────────────────────────────┘       │
│           ▲                                             │
│           │ Datasources:                                │
│           │ - LibreNMS API                              │
│           │ - Prometheus (métricas internas)            │
│           └─────────────────────────────────────        │
└──────────────────────────────────────────────────────────┘
```

---

## 🐳 **Implementação com Docker Compose**

### **docker-compose.yml** (adicionar serviços)

```yaml
services:
  # ... serviços existentes ...

  # LibreNMS
  librenms:
    image: librenms/librenms:latest
    container_name: netbox-ops-center-librenms
    hostname: librenms
    cap_add:
      - NET_ADMIN
      - NET_RAW
    ports:
      - "8000:8000"  # Web UI
    environment:
      - TZ=America/Sao_Paulo
      - PUID=1000
      - PGID=1000
      - DB_HOST=librenms-db
      - DB_NAME=librenms
      - DB_USER=librenms
      - DB_PASSWORD=librenms
      - DB_TIMEOUT=60
      - LIBRENMS_SNMP_COMMUNITY=public
      - LIBRENMS_WEATHERMAP=false
      - LIBRENMS_SMOKEPING=false
    volumes:
      - librenms_data:/data
    depends_on:
      - librenms-db
      - librenms-redis
    networks:
      - netbox-net
    restart: unless-stopped

  # LibreNMS Database
  librenms-db:
    image: mariadb:10.11
    container_name: netbox-ops-center-librenms-db
    command:
      - "mysqld"
      - "--innodb-file-per-table=1"
      - "--lower-case-table-names=0"
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"
    environment:
      - TZ=America/Sao_Paulo
      - MYSQL_ROOT_PASSWORD=librenms_root
      - MYSQL_DATABASE=librenms
      - MYSQL_USER=librenms
      - MYSQL_PASSWORD=librenms
    volumes:
      - librenms_db_data:/var/lib/mysql
    networks:
      - netbox-net
    restart: unless-stopped

  # LibreNMS Redis (para jobs)
  librenms-redis:
    image: redis:7-alpine
    container_name: netbox-ops-center-librenms-redis
    networks:
      - netbox-net
    restart: unless-stopped

  # Grafana
  grafana:
    image: grafana/grafana:latest
    container_name: netbox-ops-center-grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_INSTALL_PLUGINS=grafana-worldmap-panel,grafana-piechart-panel
    volumes:
      - grafana_data:/var/lib/grafana
    networks:
      - netbox-net
    restart: unless-stopped

volumes:
  # ... volumes existentes ...
  librenms_data:
  librenms_db_data:
  grafana_data:
```

---

## 🔌 **Integração via API**

### **1. Sincronizar Devices do NetBox Ops → LibreNMS**

**Criar processor BullMQ** (`server/src/queues/processors/librenms-sync.js`):

```javascript
import fetch from 'node-fetch';

const LIBRENMS_URL = process.env.LIBRENMS_URL || 'http://librenms:8000';
const LIBRENMS_TOKEN = process.env.LIBRENMS_API_TOKEN || '';

export async function processLibrenmsSync(job) {
  const { devices } = job.data;

  for (const device of devices) {
    try {
      // Add device to LibreNMS
      const response = await fetch(`${LIBRENMS_URL}/api/v0/devices`, {
        method: 'POST',
        headers: {
          'X-Auth-Token': LIBRENMS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: device.ipAddress,
          display: device.name,
          snmp_version: device.snmpVersion || 'v2c',
          community: device.snmpCommunity || 'public',
          port: device.snmpPort || 161,
          transport: 'udp',
        }),
      });

      if (response.ok) {
        await job.log(`Added device ${device.name} to LibreNMS`);
      }
    } catch (err) {
      await job.log(`Failed to add ${device.name}: ${err.message}`);
    }
  }

  return { success: true, devicesProcessed: devices.length };
}
```

### **2. Buscar Status dos Devices do LibreNMS**

```javascript
async function getLibrenmsDeviceStatus(deviceId) {
  const response = await fetch(`${LIBRENMS_URL}/api/v0/devices/${deviceId}`, {
    headers: { 'X-Auth-Token': LIBRENMS_TOKEN },
  });

  const data = await response.json();
  return {
    status: data.device.status ? 'up' : 'down',
    uptime: data.device.uptime,
    lastPolled: data.device.last_polled,
  };
}
```

### **3. Buscar BGP Peers**

```javascript
async function getLibrenmsBgpPeers(deviceId) {
  const response = await fetch(`${LIBRENMS_URL}/api/v0/devices/${deviceId}/bgp`, {
    headers: { 'X-Auth-Token': LIBRENMS_TOKEN },
  });

  const data = await response.json();
  return data.bgp_peers.map(peer => ({
    ip: peer.bgpPeerIdentifier,
    asn: peer.bgpPeerRemoteAs,
    state: peer.bgpPeerState === 'established' ? 'up' : 'down',
    uptime: peer.bgpPeerFsmEstablishedTime,
  }));
}
```

---

## 📋 **Plano de Migração**

### **Fase 1: Adicionar LibreNMS + Grafana** (1-2 dias)

1. ✅ Adicionar serviços ao `docker-compose.yml`
2. ✅ Configurar variáveis de ambiente
3. ✅ Gerar API token no LibreNMS
4. ✅ Criar dashboards básicos no Grafana

### **Fase 2: Integração Backend** (2-3 dias)

1. ✅ Criar processor `librenms-sync`
2. ✅ Adicionar job ao scheduler (sync devices a cada 15min)
3. ✅ Modificar schema Prisma:
   ```prisma
   model Device {
     ...
     libreNmsId      String?   // ID do device no LibreNMS
     libreNmsStatus  String?   // "up", "down", "disabled"
     lastLibreNmsCheck DateTime?
   }
   ```
4. ✅ Atualizar endpoint `/devices` para ler status do LibreNMS

### **Fase 3: Deprecar CheckMK** (1 dia)

1. ✅ Remover container `checkmk`
2. ✅ Remover processor `checkmk-sync`
3. ✅ Remover campos `checkmkStatus` do schema
4. ✅ Atualizar documentação

---

## 💰 **Custo vs Benefício**

| Item | CheckMK | **LibreNMS** |
|------|---------|--------------|
| **Recursos (CPU/RAM)** | 🔴 Alto (2GB+ RAM) | 🟢 **Baixo (512MB RAM)** |
| **Especialização Rede** | 🟡 Genérico | 🟢 **Especializado** |
| **BGP Monitoring** | 🔴 Não nativo | 🟢 **Nativo** |
| **Grafana Integration** | 🟡 Possível | 🟢 **Nativo** |
| **Setup Complexity** | 🔴 Alto | 🟢 **Baixo** |
| **API Quality** | 🟢 Boa | 🟢 **Excelente** |
| **Community** | 🟢 Ativa | 🟢 **Muito ativa** |

---

## ⚙️ **Configuração Pós-Instalação**

### **1. Primeiro acesso ao LibreNMS**

```bash
# Acessar: http://IP:8000
# Usuário: admin
# Senha: (gerada na primeira instalação, ver logs)
docker logs netbox-ops-center-librenms | grep "Admin password"
```

### **2. Gerar API Token**

1. Login no LibreNMS
2. Ir em **Settings → API → API Settings**
3. Criar novo token
4. Copiar e adicionar ao `.env`:
   ```bash
   LIBRENMS_API_TOKEN=seu_token_aqui
   ```

### **3. Configurar Grafana Datasource**

1. Acessar Grafana: `http://IP:3000`
2. **Configuration → Data Sources → Add data source**
3. Selecionar **LibreNMS**
4. URL: `http://librenms:8000`
5. API Token: (colar o token gerado)
6. **Save & Test**

---

## 🎯 **Dashboards Recomendados**

### **Dashboard 1: Network Overview**
- Total devices (up/down)
- Bandwidth utilization (top 10)
- CPU/Memory por device
- Alertas ativos

### **Dashboard 2: BGP Peers**
- Total peers (established/down)
- Peer state timeline
- Prefixes recebidos/enviados
- ASN map

### **Dashboard 3: Interface Health**
- Errors/Discards por interface
- Utilization heatmap
- Top talkers
- Duplex mismatches

---

## 🔍 **Alternativa: Prometheus + Grafana (Puro)**

Se você quiser uma solução mais **simples** e **leve**:

### **Prós:**
- ✅ Stack moderno e escalável
- ✅ Grafana integrado
- ✅ Baixo consumo de recursos
- ✅ Excelente para time-series

### **Contras:**
- ❌ Sem auto-discovery SNMP nativo
- ❌ Precisa configurar SNMP exporter manualmente
- ❌ Não tem network maps
- ❌ Menos features de networking

### **Quando usar:**
- Se você quer **simplicidade máxima**
- Se não precisa de features avançadas de NMS
- Se já tem Prometheus em produção

---

## ✅ **Conclusão e Recomendação Final**

### **Para o NetBox Ops Center:**

**🏆 Recomendo LIBRENMS + GRAFANA** pelos seguintes motivos:

1. **Foco em Networking** - Especializado para seu caso de uso
2. **Menor Overhead** - Mais leve que CheckMK
3. **BGP Nativo** - Integra com o que você já coleta
4. **API Excelente** - Integração fácil com Node.js
5. **Grafana Ready** - Dashboards poderosos out-of-the-box
6. **Auto-discovery** - Menos trabalho manual

### **Próximos Passos:**

1. **Adicionar LibreNMS ao docker-compose** (5 min)
2. **Configurar API token** (2 min)
3. **Criar processor de sync** (30 min)
4. **Configurar Grafana** (15 min)
5. **Testar com alguns devices** (10 min)

**Tempo total estimado**: ~1 hora para PoC funcional

---

**Quer que eu implemente a integração LibreNMS agora?**

Posso:
- ✅ Atualizar `docker-compose.yml`
- ✅ Criar processor `librenms-sync.js`
- ✅ Adicionar job ao scheduler
- ✅ Atualizar schema Prisma
- ✅ Modificar endpoint `/devices`

Me avise se quer prosseguir! 🚀
