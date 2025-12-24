# v0.1.0 – Primeira release

Principais novidades
- Gateway SNMP (Node + net-snmp) com descoberta de Interfaces e Peers BGP (inclui localAsn e tentativa de descrição do peer)
- API Express + Prisma (SQLite) com modelos para Devices, Tenants, Applications, Descobertas (Interfaces/Peers), ASN Registry e AuditLog
- UI Vite + React + shadcn-ui
  - Dispositivos: CRUD, edição de credenciais com máscara e criptografia no servidor (AES‑256‑GCM)
  - BGP Peers: persistência no banco, enriquecimento com nomes de ASN, filtro por tenant e opção “Mostrar iBGP”
  - Configurações: descoberta por SNMP e salvamento em banco (interfaces e peers)
  - Aplicações: cadastro e integração com NetBox (catálogo + sync com filtros), Jumpserver (teste)
  - Dashboard: contadores reais de Dispositivos Ativos, Peers Descobertos e Tenants registrados (grupo “K3G Solutions”)
  - Manutenção: resumo, purge (dry-run/global), snapshot export/import e auditoria
  - Usuários: login por email ou username, /me para perfil e troca de senha, /users (admin) para gestão
- Boot tasks: enriquecimento de ASN a partir de peers registrados
- NetBox: filtro por Tenant Group (padrão “K3G Solutions”), sync com filtros opcionais (roles, platforms, device types, sites)
- Sessão: 30m inativo → aviso 30s → logout; 401 exibe “Sessão expirada…”, 403 mostra “Acesso negado…” sem desconectar
- Docker: script de deploy que sobe Web+API+SNMP (porta externa padrão 58080)
- Diagnóstico: script scripts/quick-diagnose.sh para checagens rápidas (Web, API, SNMP, login, tenants, NetBox)

Mudanças importantes (atenção)
- Atualização de credenciais de dispositivo agora é via endpoint dedicado:
  - GET/PATCH /devices/:id/credentials (password cifrada no banco). Não enviar `credentials` no PATCH /devices/:id.
- Lista de tenants para admin é filtrada por NETBOX_TENANT_GROUP_FILTER (padrão: “K3G Solutions”).

Variáveis de ambiente (principais)
- .env (raiz)
  - VITE_USE_BACKEND=true, VITE_API_URL=/api
  - API_SERVER_URL=http://localhost:4000, SNMP_SERVER_URL=http://localhost:3001
  - DATABASE_URL=postgresql://..., PORT=4000
  - NETBOX_TENANT_GROUP_FILTER=K3G Solutions
- .env.local (opcional)
  - JWT_SECRET=<defina um valor forte>, CRED_ENCRYPTION_KEY=<chave forte>
  - (Opcional) overrides de tokens/URLs sensiveis

Instalação (resumo)
- cp .env.example .env (opcional: crie .env.local para segredos)
- npm install && npm run server:install && npm run db:push
- npm run dev:stack  # http://localhost:8080/
- Criar admin: node server/scripts/create-admin.js
- Testar SNMP: curl "http://localhost:3001/api/snmp/ping?ip=127.0.0.1&community=public"
