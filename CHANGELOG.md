# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.2.0] - 2025-11-22

### ✨ Adicionado
- **Integração NetBox Completa**: Sincronização automática de dispositivos, tenants, sites e custom fields
- **Gestão de Credenciais**: Suporte a NetBox Secrets Plugin com fallback para credenciais da aplicação
- **Filtros de Sincronização**: Filtragem por Tenant Group, roles, platforms, device types e sites
- **Exclusão Inteligente**: Filtro automático de dispositivos "Caixa Preta" (case-insensitive com variações)
- **Backup Automático**: Integração Oxidized com mapeamento automático de vendors/drivers
- **Diff de Configurações**: Comparação visual entre versões de backup
- **Acesso SSH**: Sessões SSH diretas via browser com registro de logs
- **Multi-Tenant**: Isolamento completo de dados por tenant
- **API de Saúde**: Endpoint `/health/services` para monitoramento de serviços
- **Scripts de Debug**: Biblioteca de ferramentas de diagnóstico em `server/debug/`

### 🔧 Modificado
- **Manutenção > Zona de Perigo**: Botão de limpeza agora funciona corretamente para admins globais
- **Sincronização NetBox**: Performance otimizada (cache de session key para evitar tentativas repetidas)
- **UI de Aplicações**: Campos para credenciais SSH (Login/Senha) e chave RSA privada
- **README.md**: Documentação completa com guias de instalação, configuração e troubleshooting

### 🐛 Corrigido
- **Prisma Error**: Removido argumento `mode: 'insensitive'` não suportado no SQLite
- **Filtro "Caixa Preta"**: Regex aprimorado para capturar variações como `01-CAIXA-PRETA`
- **Database Corruption**: Adicionado guia de recuperação no README
- **Credential Fallback**: Implementação correta do fallback (Secrets → Custom Fields → App Config)
- **Session Key Caching**: Evita milhares de requisições falhadas quando a chave RSA é inválida

### 🔐 Segurança
- Criptografia AES-256-GCM para credenciais no banco
- Arquivo de chave RSA com permissões `0600`
- `.gitignore` atualizado para excluir `.env`, `.pem`, `.db*` e `server/debug/`

---

## [v0.1.0] - 2025-11-15

### ✨ Adicionado
- Interface web com React + Vite
- Backend Node.js + Express
- Autenticação JWT
- Discover SNMP (Interfaces e BGP Peers)
- Integração básica com NetBox
- Integração com Oxidized
- Portainer para gestão de containers
- Scripts de instalação (`install.sh`, `deploy_remote.sh`)
- Docker Compose para deploy simplificado

---

## [Unreleased]

### 🚧 Planejado
- Integração Jumpserver para acesso SSH
- Suporte a PostgreSQL
- Dashboard com métricas de rede
- Alertas e notificações
- Backup incremental

---

[v0.2.0]: https://github.com/keslleykledston/11-Netbox_ops_center/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/keslleykledston/11-Netbox_ops_center/releases/tag/v0.1.0
