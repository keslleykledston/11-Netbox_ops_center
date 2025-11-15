## NetBox Ops Center (NetManager)

Aplicação de gestão de rede com descoberta via SNMP, catálogo e sincronização de dispositivos a partir do NetBox, registro de BGP peers com enriquecimento de ASN, painel de manutenção (purga/backup/auditoria) e gerenciamento de usuários/tenants. Frontend em Vite React + shadcn-ui, backend em Node/Express com Prisma (SQLite) e gateway SNMP em Node.

Principais componentes
- Frontend: Vite + React + shadcn-ui (porta 8080)
- API: Express + Prisma SQLite (porta 4000)
- Gateway SNMP: net-snmp (porta 3001)
- Integrações: NetBox (sync/catálogo), Jumpserver (teste), ASN lookup (bgpview/rdap)

Funcionalidades
- Autenticação (login por email ou username) e sessão com inatividade (30m + aviso 30s)
- Tenants com filtro por Tenant Group (padrão: “K3G Solutions”)
- Dispositivos: CRUD, credenciais cifradas (AES‑256‑GCM), descoberta de interfaces e peers via SNMP
- BGP Peers: persistência no banco, enriquecimento com nome do ASN, filtro iBGP/eBGP, filtro por tenant
- Aplicações: cadastro e testes básicos (NetBox/Jumpserver), sincronização com filtros (role, plataforma, tipo, site)
- Manutenção: resumo, purga (com dry-run), snapshot (export/import), auditoria de ações
- Usuários/Admin: criação/edição/ativação, mudança de senha, escopo por tenant

Arquitetura (alta visão)
- Web (Vite) proxy para API e SNMP: vite.config.ts
- Backend (server/) expõe REST e usa Prisma (SQLite por padrão)
- SNMP gateway (snmp-server.js) executa walk/subtree e normaliza respostas

Requisitos
- Node.js 18+ (recomendado 20+)
- npm
- (Opcional) Docker + Docker Compose para deploy rápido
- Acesso SNMP aos equipamentos e, se usar NetBox, URL + Token

Instalação automatizada (Docker ou bare-metal)
---------------------------------------------
Para reproduzir o ambiente validado (Docker + Portainer ou bare-metal com systemd), use o novo script interativo:

```bash
sudo ./scripts/deploy_netbox_ops_center_docker.sh
```

O assistente pergunta:

1. **Modo Docker** – instala Docker Engine + compose plugin, Portainer CE (8000/9443) e prepara o repositório em `/opt/netbox-ops-center` (ou caminho informado). Gera `.env`, `server/.env` e um `docker-compose.yml` atualizado com `node:20-bullseye`, aplica `npm install`/`npm run server:install` automaticamente dentro do container e sobe o stack com `npm run dev:stack`. Após o `docker compose up -d`, o script valida o acesso HTTP (`curl http://localhost:<porta>`), mostra `docker compose ps` e informa URLs finais.

2. **Modo bare-metal** – instala Node.js 20 via NodeSource (se necessário), cria o usuário de serviço `netboxops`, clona o projeto, executa `npm install`, `npm run server:install`, `npm run db:push`, e gera um serviço systemd (`/etc/systemd/system/netbox-ops-center.service`) que roda `npm run dev:stack`. O script aguarda o HTTP responder (`http://localhost:8080`), habilita o serviço no boot e informa como acompanhar logs.

Ambos os fluxos reutilizam o mesmo repositório e arquivos `.env`, além de realizarem testes automáticos (curl) para garantir que a UI responda após a instalação. Escolha a opção que melhor se encaixa no seu cenário (laboratório rápido com containers ou execução direta no host).

### Criar usuário admin via wizard

Após a instalação, utilize o assistente para criar/atualizar um administrador:

```bash
# Caminho compatível com documentações antigas ("server/script") e o atual ("server/scripts")
node server/scripts/admin-wizard.js
# ou
./server/script/admin-wizard.js
```

O script pergunta e-mail/usuário/senha, faz a confirmação e grava (ou atualiza) o admin diretamente no banco definido em `server/.env`.

> **Admin padrão automático:** durante a instalação é criado o usuário `suporte@suporte.com.br` com senha `Ops_pass_`. O login inicial exige redefinição imediata da senha. A tela de login exibe a dica enquanto o usuário não alterar a credencial.

Instalação (desenvolvimento)
1) Dependências e envs
   - cp .env.example .env
   - cp server/.env.example server/.env
   - Ajuste server/.env: defina JWT_SECRET e CRED_ENCRYPTION_KEY
   - (Opcional) defina NETBOX_URL/NETBOX_TOKEN em .env ou server/.env
2) Instale pacotes
   - npm install
   - npm run server:install
3) Inicialize o banco
   - npm run db:push
4) Suba tudo com auto‑reload (web + API + SNMP)
   - npm run dev:stack
   - Acesse: http://localhost:8080/

Instalação completa (comandos)
- macOS (Homebrew) – dependências essenciais
  - /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  - brew install git jq
  - brew install --cask docker  # depois inicie o Docker Desktop
  - curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  - export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
  - nvm install 20 && nvm use 20
  - node -v && npm -v

- Ubuntu/Debian – dependências essenciais
  - sudo apt-get update && sudo apt-get install -y git curl jq ca-certificates build-essential
  - curl -fsSL https://get.docker.com | sudo sh
  - sudo usermod -aG docker "$USER"  # faça logout/login para aplicar
  - curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  - export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
  - nvm install 20 && nvm use 20
  - node -v && npm -v && docker --version

- Clonar o repositório e instalar pacotes
  - git clone https://github.com/keslleykledston/11-Netbox_ops_center.git
  - cd 11-Netbox_ops_center
  - npm install
  - npm run server:install

- Preparar variáveis de ambiente
  - cp .env.example .env
  - cp server/.env.example server/.env
  - # Gere segredos rapidamente (opcional)
  - JWT_SECRET=$(openssl rand -hex 24); CRED_ENC=$(openssl rand -base64 32)
  - sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" server/.env && rm -f server/.env.bak
  - sed -i.bak "s/^CRED_ENCRYPTION_KEY.*/CRED_ENCRYPTION_KEY=${CRED_ENC}/" server/.env || echo "CRED_ENCRYPTION_KEY=${CRED_ENC}" >> server/.env
  - # (Opcional) configure NETBOX_URL/NETBOX_TOKEN em .env ou server/.env

- Inicializar o banco de dados (Prisma/SQLite)
  - npm run db:push

- Executar toda a stack (Web + API + SNMP)
  - npm run dev:stack
  - # Web:   http://localhost:8080/
  - # API:   http://localhost:4000/health
  - # SNMP:  http://localhost:3001/api/snmp/ping?ip=127.0.0.1&community=public

- Criar usuário admin e testar login via API
  - node server/scripts/create-admin.js
  - # Faça login por email OU username
  - TOKEN=$(curl -sS -X POST http://localhost:4000/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"identifier":"keslley.k3g","password":"#100784KyK_"}' | jq -r .token)
  - echo "$TOKEN"
  - # Testar endpoints autenticados
  - curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:4000/tenants | jq
  - curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:4000/stats/overview | jq

- Testes do gateway SNMP (sem alterar código)
  - # Ping SNMP (sysName)
  - curl -sS "http://localhost:3001/api/snmp/ping?ip=138.219.128.1&community=Inforrnet&port=161" | jq
  - # Descoberta de peers BGP (traz peers[].ip/asn e tenta peers[].name)
  - curl -sS "http://localhost:3001/api/snmp/bgp-peers?ip=138.219.128.1&community=Inforrnet&port=161" | jq

- Catálogo NetBox (se NETBOX_URL/TOKEN configurados)
  - curl -sS -X POST http://localhost:4000/netbox/catalog \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"resources":["device-roles","platforms","device-types","sites"]}' | jq

Deploy com Docker (porta externa 58080)
- Script pronto: scripts/deploy_netbox_ops_center_docker.sh
  - chmod +x scripts/deploy_netbox_ops_center_docker.sh
  - ./scripts/deploy_netbox_ops_center_docker.sh
  - Personalize: APP_DIR=/opt/netbox-ops-center EXTERNAL_PORT=58080 ./scripts/deploy_netbox_ops_center_docker.sh
  - Acesse: http://localhost:58080/

Variáveis de ambiente (principais)
- .env (raiz)
  - VITE_USE_BACKEND=true
  - VITE_API_URL=/api
  - API_SERVER_URL=http://localhost:4000 (proxy do Vite)
  - SNMP_SERVER_URL=http://localhost:3001 (proxy do Vite)
  - NETBOX_TENANT_GROUP_FILTER=K3G Solutions
- server/.env
  - DATABASE_URL="file:./dev.db"
  - PORT=4000
  - JWT_SECRET=troque_este_valor
  - CRED_ENCRYPTION_KEY=chave_forte_de_32+_bytes
  - (Opcional) NETBOX_URL/NETBOX_TOKEN

Comandos básicos
- npm run server:install   # instala dependências do backend
- npm run db:push          # aplica schema Prisma (SQLite por padrão)
- npm run dev              # inicia apenas o Vite
- npm run server:dev       # inicia apenas a API
- npm run snmp-server      # inicia o gateway SNMP (node --watch)
- npm run dev:all          # API + SNMP + Web
- npm run dev:stack        # db:push + dev:all
- npm run db:studio        # Prisma Studio (GUI do banco)
- npm run server:test      # testes do backend

Diagnóstico rápido
- scripts/quick-diagnose.sh
  - chmod +x scripts/quick-diagnose.sh
  - ./scripts/quick-diagnose.sh
  - Lê .env e server/.env, verifica portas (Web/API/SNMP), tenta login (se ADMIN_* definidos), consulta /tenants e testa catálogo NetBox.

Fluxos principais
- Login e sessão: /auth/login (identifier = email ou username). Sessão expira em 401 e redireciona com toast “Sessão expirada…”.
- Tenants: GET /tenants retorna o tenant do usuário; admins recebem lista filtrada pelo Tenant Group.
- Dispositivos: CRUD em /devices; credenciais via /devices/:id/credentials (GET/PATCH, password cifrada).
- Descoberta SNMP: /api/snmp/interfaces e /api/snmp/bgp-peers (gateway) + persistência em /devices/:id/discovery/*.
- BGP Peers: GET /bgp/peers (retorna asn/localAsn/nome enriquecido). UI oculta iBGP por padrão, com opção para mostrar.
- NetBox: /netbox/catalog e /netbox/sync com filtros (roles, platforms, device types, sites). Filtro de Tenant Group aplicado.
- Manutenção: /admin/summary, /admin/purge (dryRun/global), /admin/snapshot, /admin/import-snapshot, /admin/audit.
- Usuários/Admin: /admin/users (CRUD), /me (perfil e troca de senha), script de criação de admin em server/scripts.

Criar usuário Admin
- Wizard interativo: node server/scripts/admin-wizard.js
- Automático (variáveis): ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD e rode: node server/scripts/create-admin.js

Verificação rápida (checklist)
- Web (Vite): http://localhost:8080 (Docker: http://localhost:58080). Se indisponível, rode npm run dev:stack (ou docker compose up -d) e verifique logs.
- API: curl http://localhost:4000/health deve retornar { ok: true }. Se a UI falha em /api/*, confirme VITE_API_URL=/api e API_SERVER_URL no .env.
- Proxy Vite: vite.config.ts reescreve /api → API_SERVER_URL e /api/snmp → SNMP_SERVER_URL. Ajuste .env se API/SNMP estiverem em outros hosts/portas.
- Node/Deps: node -v (>= 18, ideal 20), npm -v, npm install e npm run server:install concluídos sem erros.
- Banco/Prisma: npm run db:push deve criar/atualizar server/prisma/dev.db. Se falhar, checar server/.env (DATABASE_URL).
- Login/Token: POST /auth/login com identifier (email OU username) e senha. 401 em rotas não /auth implica “Sessão expirada”; 403 indica sem permissão.
- Tenants: GET /tenants retorna seu tenant; admin recebe lista filtrada por NETBOX_TENANT_GROUP_FILTER (ex.: “K3G Solutions”). Se vazio, sincronize do NetBox.
- SNMP gateway: curl "http://localhost:3001/api/snmp/ping?..." e bgp-peers. Se timeout, revise IP/community/porta, SNMP_MAX_REPETITIONS/SNMP_GLOBAL_TIMEOUT_MS e firewall.
- NetBox: defina NETBOX_URL/TOKEN e teste /netbox/catalog via curl com Authorization: Bearer $TOKEN. 404 sugere API parada; 401/403 indicam token/permissão.
- Portas em uso: lsof -i :8080 (ou :4000/:3001/:58080). Libere processos ou altere EXTERNAL_PORT no Docker.
- Credenciais de dispositivo: atualize via /devices/:id/credentials (GET/PATCH). Não envie campo credentials no PATCH /devices/:id.
- Permissões admin: /admin/* requer role=admin (global). Para purga global, envie { global: true } além da confirmação “APAGAR”.

Solução de problemas (troubleshooting)
- 404 em /api/netbox/catalog
  - API não está rodando ou VITE_API_URL/proxy incorretos. Inicie com npm run dev:stack.
- ERR_CONNECTION_REFUSED ao chamar /api/*
  - Verifique API_SERVER_URL no .env e se a API está ativa (porta 4000). O Vite proxy reescreve /api → http://localhost:4000.
- 403 em /api/admin/*
  - Operação exige admin (global) ou token válido. Faça login como admin; 401 aciona “Sessão expirada…”.
- PrismaClientValidationError: Unknown argument `credentials`
  - As credenciais agora são atualizadas via /devices/:id/credentials. Atualize o frontend/cliente para usar o endpoint dedicado.
- SNMP: “Falha no SNMP/timeout”
  - Confirme IP/community/porta. Ajuste SNMP_MAX_REPETITIONS e SNMP_GLOBAL_TIMEOUT_MS no .env. Cheque firewalls.
- “Cannot find package 'dotenv' importado do snmp-server.js”
  - Use o script npm run dev:all, que inicia via server/snmp-entry.js com import 'dotenv/config'. Requer Node 18+.

Notas de segurança
- Defina JWT_SECRET e CRED_ENCRYPTION_KEY fortes em produção.
- Senhas de dispositivos são cifradas (AES‑256‑GCM) e nunca retornam em listagens.
- Exponha somente portas necessárias e use TLS/HTTPS em produção (proxy reverso recomendado).

Portas padrão
- Web (Vite): 8080 → (Docker: mapeada para 58080 pelo script)
- API: 4000
- SNMP gateway: 3001

Licença
Este repositório contém código de uso interno. Adapte a licença conforme a sua política organizacional.
