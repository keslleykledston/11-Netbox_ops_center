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

## 📋 Serviços Disponíveis

| Serviço | Porta/URL | Descrição |
|---------|-----------|-----------|
| **App Principal** | `http://IP/` | Interface web principal |
| **Portainer** | `http://IP/portainer/` | Gestão de containers |
| **Oxidized** | `http://IP/oxidized/` | Interface do Oxidized |
| **API Backend** | `http://IP/api/` | API REST |

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

### Banco de dados corrompido

```bash
# Pare o container
docker stop netbox-ops-center-app

# Delete o banco
docker exec netbox-ops-center-app rm -f /app/server/prisma/dev.db*

# Reinicie
docker start netbox-ops-center-app
```

Depois, recadastre o usuário admin e a aplicação NetBox.

### Logs para Debug

```bash
# Logs do backend
docker logs netbox-ops-center-app -f

# Logs do Oxidized
docker logs netbox-ops-center-oxidized -f
```

## 🗂️ Estrutura do Projeto

```
├── server/              # Backend Node.js
│   ├── src/            # Código fonte
│   │   ├── index.js    # API principal
│   │   ├── netbox.js   # Integração NetBox
│   │   └── queues/     # Jobs assíncronos (BullMQ)
│   ├── prisma/         # Schema do banco SQLite
│   └── debug/          # Scripts de debug (não incluídos no Git)
├── src/                # Frontend React + Vite
├── docker/             # Dockerfiles
├── install.sh          # Instalador local
├── deploy_remote.sh    # Deploy remoto
└── update.sh           # Script de atualização
```

## 🔐 Segurança

- ⚠️ **Nunca commite** arquivos `.env`, chaves privadas ou `dev.db`
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

Veja `.env.example` para lista completa. Principais:

- `NETBOX_URL` / `NETBOX_TOKEN`: Credenciais do NetBox
- `NETBOX_TENANT_GROUP_FILTER`: Grupo de tenants a sincronizar
- `OXIDIZED_ENABLED`: Habilitar Oxidized
- `JWT_SECRET`: Secret para tokens JWT

</details>

## 📄 Licença

MIT

## 🤝 Contribuindo

Pull requests são bem-vindos! Para mudanças grandes, abra uma issue primeiro.
