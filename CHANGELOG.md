# Changelog

Todas as mudanças notáveis deste projeto serão documentadas aqui.

## [v0.1.0] - 2025-11-14

Primeira release pública do NetBox Ops Center (NetManager).

### Novidades
- Gateway SNMP (Node + net-snmp) com descoberta de Interfaces e Peers BGP (inclui `localAsn` e tentativa de descrição de peer quando suportada)
- API Express + Prisma (SQLite) com modelos para Devices, Tenants, Applications, Descobertas (Interfaces/Peers), ASN Registry e AuditLog
- UI Vite + React + shadcn-ui
  - Dispositivos: CRUD, edição de credenciais com máscara e criptografia no servidor (AES‑256‑GCM)
  - BGP Peers: persistência no banco, enriquecimento com nomes de ASN, filtro por tenant e opção “Mostrar iBGP”
  - Configurações: descoberta por SNMP e salvamento em banco (interfaces e peers)
  - Aplicações: cadastro e integração com NetBox (catálogo + sync com filtros), Jumpserver (teste)
  - Dashboard: contadores reais de Dispositivos Ativos, Peers Descobertos e Tenants (grupo “K3G Solutions”)
  - Manutenção: resumo, purge (dry-run/global), snapshot export/import e auditoria
  - Usuários: login por email ou username, /me para perfil e troca de senha, /users (admin) para gestão
- Boot tasks: enriquecimento de ASN a partir de peers já registrados
- NetBox: filtro por Tenant Group (padrão “K3G Solutions”); sync com filtros opcionais (roles, platforms, device types, sites)
- Sessão: 30m inativo → aviso 30s → logout; 401 exibe “Sessão expirada…”, 403 mostra “Acesso negado…” sem desconectar
- Docker: script de deploy que sobe Web+API+SNMP (porta externa padrão 58080)
- Diagnóstico: script `scripts/quick-diagnose.sh` para checagens rápidas (Web, API, SNMP, login, tenants, NetBox)

### Mudanças importantes
- Atualização de credenciais de dispositivo agora é via endpoint dedicado:
  - `GET/PATCH /devices/:id/credentials` (password cifrada no banco). Não enviar `credentials` no `PATCH /devices/:id`.
- Lista de tenants para admin é filtrada por `NETBOX_TENANT_GROUP_FILTER` (padrão: “K3G Solutions”).

### Notas
- Defina `JWT_SECRET` e `CRED_ENCRYPTION_KEY` fortes em produção.
- Use TLS/HTTPS e restrinja portas expostas conforme necessidade.

[v0.1.0]: https://github.com/keslleykledston/11-Netbox_ops_center/releases/tag/v0.1.0
