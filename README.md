# NetBox Ops Center

Uma plataforma completa de gestão de rede, integrando **NetBox**, monitoramento SNMP, backups automáticos com **Oxidized**, acesso SSH e gestão de containers com Portainer.

## ✨ Funcionalidades

- 🔗 **Integração NetBox**: Sincronização automática de dispositivos, tenants, sites e credenciais
- 📦 **Backup Automático**: Oxidized integrado com suporte a múltiplos vendors (Huawei VRP, MikroTik, Cisco, etc.)
- 🔐 **Gestão de Credenciais**: Suporte a NetBox Secrets Plugin + fallback configurável
- 🖥️ **Acesso SSH**: Sessões SSH diretas via browser (integração opcional com Jumpserver)
- 📊 **Descoberta SNMP**: Interfaces e peers BGP
- 🎯 **Multi-tenant**: Isolamento de dados por tenant
- 🔍 **Diff de Configurações**: Comparação visual entre versões de backup
- ⚙️ **API REST**: Backend Node.js + Express
- 📈 **Monitoramento LibreNMS**: Monitoramento SNMP automático de dispositivos
- 📊 **Dashboards Grafana**: Visualização avançada de métricas de rede
- 🔍 **Observabilidade**: Métricas Prometheus (`/api/metrics`) e sanitização de logs

## 🚀 Instalação Rápida

### Pré-requisitos
- Linux (Ubuntu/Debian recomendado)
- Docker + Docker Compose
- Git

### Método 1: Instalação Local

```bash
# Clone o repositório
git clone https://github.com/keslleykledston/11-Netbox_ops_center.git
cd 11-Netbox_ops_center

# Execute o instalador
sudo ./install.sh
```

O script irá:
- Instalar Docker e Docker Compose (se necessário)
- Configurar variáveis de ambiente
- Instalar dependências Node.js
- Subir todos os containers
- Configurar proxy reverso Nginx

### Método 2: Deploy Remoto

```bash
# Sintaxe: ./deploy_remote.sh [IP] [USUARIO] [SENHA]
./deploy_remote.sh 192.168.1.100 admin mypassword
```

## 🔧 Configuração Inicial

### 1. Primeiro Acesso

Acesse `http://SEU_IP/` e crie o usuário administrador.

### 2. Configurar NetBox

1. Vá em **Aplicações** > **Adicionar Aplicação**
2. Preencha:
   - **Nome**: `NetBox`
   - **URL**: `https://seu-netbox.com`
   - **API Key**: Seu token do NetBox
   - **Login (Opcional)**: Usuário SSH padrão
   - **Senha (Opcional)**: Senha SSH padrão
   - **Chave Privada RSA**: Para NetBox Secrets Plugin (opcional)

3. Clique em **Sincronizar NetBox**

### 3. Configurar Oxidized (Opcional)

Se já tiver uma instância Oxidized externa:

1. Vá em **Aplicações** > **Adicionar Aplicação**
2. Nome: `Oxidized`
3. Configure URL e intervalo de coleta

### 4. Configurar LibreNMS + Grafana (Recomendado)

O NetBox Ops Center inclui integração completa com LibreNMS para monitoramento SNMP:

1. **Acesse o LibreNMS**: `http://SEU_IP:8009`
   - Usuário: `librenms`
   - Senha: `librenms` (altere imediatamente!)

2. **Gere um token de API**:
   - Vá em **My Settings** → **API Settings** → **Create API Token**
   - Copie o token gerado

3. **Configure o backend**:
   ```bash
   nano .env
   ```
   Adicione:
   ```
   LIBRENMS_URL=http://librenms:8000
   LIBRENMS_TOKEN=SEU_TOKEN_AQUI
   AUTO_LIBRENMS_POLL=true
   ```

4. **Reinicie os containers**:
   ```bash
   docker compose restart backend scheduler
   ```

5. **Acesse o Grafana**: `http://SEU_IP:3033`
   - Usuário: `admin`
   - Senha: `admin` (altere no primeiro acesso)

6. **Configure datasource**:
   - Vá em **Configuration** → **Data Sources** → **Add data source**
   - Selecione **MySQL**
   - Host: `librenms-db:3306`
   - Database: `librenms`
   - User/Password: `librenms`

**📖 Guia completo**: Veja [LIBRENMS_SETUP_GUIDE.md](LIBRENMS_SETUP_GUIDE.md)

## 📋 Serviços Disponíveis

| Serviço | Porta/URL | Descrição |
|---------|-----------|-----------|
| **App Principal** | `http://IP/` | Interface web principal |
| **API Backend** | `http://IP/api/` | API REST |
| **Prometheus Metrics** | `http://IP/api/metrics` | Métricas de observabilidade |
| **LibreNMS** | `http://IP:8009` | Monitoramento de rede |
| **Grafana** | `http://IP:3033` | Dashboards e visualização |
| **Portainer** | `http://IP/portainer/` | Gestão de containers |
| **Oxidized** | `http://IP/oxidized/` | Interface do Oxidized |

## 🔄 Atualização

```bash
cd 11-Netbox_ops_center
./update.sh
```

O script verifica a versão no GitHub e atualiza automaticamente.

## 🛠️ Solução de Problemas

### Erro: "0 devices imported" na sincronização

1. Verifique filtros de Tenant Group (padrão: "K3G Solutions")
2. Certifique-se que os dispositivos têm IPs primários configurados
3. Veja variável `NETBOX_TENANT_GROUP_FILTER` no `.env`

### Credenciais não aparecem nos dispositivos

1. Verifique se preencheu **Login/Senha** na configuração do NetBox (aba Aplicações)
2. Se usar NetBox Secrets: cole a chave RSA privada correta
3. As credenciais usam fallback: Secrets → Custom Fields → **Config da App**

### Reset do banco de dados PostgreSQL

```bash
# Pare todos os containers
docker compose down

# Remova o volume do banco (CUIDADO: apaga todos os dados)
docker volume rm 11-netbox_ops_center_db_data

# Reinicie os serviços
docker compose up -d

# Aguarde a inicialização (~30s) e verifique os logs
docker logs netbox-ops-center-backend -f
```

Depois, recadastre o usuário admin (ou use as credenciais padrão: `admin` / `Ops_pass_`) e configure a aplicação NetBox.

### Logs para Debug

```bash
# Logs do backend (API)
docker logs netbox-ops-center-backend -f

# Logs do worker (jobs assíncronos)
docker logs netbox-ops-center-worker -f

# Logs do scheduler
docker logs netbox-ops-center-scheduler -f

# Logs do Oxidized
docker logs netbox-ops-center-oxidized -f
```

## 🗂️ Estrutura do Projeto

```
├── server/              # Backend Node.js
│   ├── src/            # Código fonte
│   │   ├── index.js    # API principal (Express + WebSocket)
│   │   ├── worker.js   # Worker BullMQ (jobs assíncronos)
│   │   ├── scheduler.js # Scheduler (jobs periódicos)
│   │   ├── netbox.js   # Integração NetBox
│   │   └── queues/     # Jobs assíncronos (BullMQ)
│   ├── prisma/         # Schema do banco PostgreSQL
│   └── debug/          # Scripts de debug (não incluídos no Git)
├── src/                # Frontend React + Vite
├── docker/             # Dockerfiles
├── install.sh          # Instalador local
├── deploy_remote.sh    # Deploy remoto
└── update.sh           # Script de atualização
```

## 🔐 Segurança

- ⚠️ **Nunca commite** arquivos `.env`, chaves privadas ou dados sensíveis
- 🔒 Credenciais são criptografadas no banco (AES-256-GCM)
- 🛡️ JWT para autenticação da API
- 📝 Logs de auditoria para ações críticas

## 🧰 Desenvolvimento

<details>
<summary>Comandos úteis para desenvolvedores</summary>

```bash
# Instalar dependências
npm install
npm --prefix server install

# Rodar em dev (sem Docker)
npm run dev

# Executar migrações do banco
npm --prefix server run prisma:migrate

# Ver schema do banco
npm --prefix server run prisma:studio

# Scripts de debug
cd server
node debug/manual_sync.js      # Sync manual do NetBox
node debug/check_db.js          # Ver contadores do banco
```

### Variáveis de Ambiente

Veja `.env.example` para lista completa. Use `.env.local` para sobrescritas locais. Principais:

- `NETBOX_URL` / `NETBOX_TOKEN`: Credenciais do NetBox
- `NETBOX_TENANT_GROUP_FILTER`: Grupo de tenants a sincronizar
- `OXIDIZED_ENABLED`: Habilitar Oxidized
- `JWT_SECRET`: Secret para tokens JWT

</details>

## 📄 Licença

MIT

## 🤝 Contribuindo

Pull requests são bem-vindos! Para mudanças grandes, abra uma issue primeiro.
