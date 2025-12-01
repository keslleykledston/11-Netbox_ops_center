# Plano Arquitetural (modelo JumpServer)

## Objetivo e escopo imediato (MVP)
- UI/Backend: listar dispositivos/tenants/sites a partir do cache local (PostgreSQL), acionar sincronização manual com NetBox e visualizar estado dos jobs (incluindo Oxidized, SNMP, backups).
- Jobs assíncronos: sync NetBox (devices, tenants, IPs, credenciais), sync Oxidized (router.db e estados), coleta SNMP/BGP básica, testes de conectividade (ping/traceroute), validação de credenciais SSH.
- Tempo real: canal WebSocket para progresso/resultado de jobs (sync, coleta, backups) e eventos de disponibilidade dos devices.
- Segurança: segredos vindos do NetBox Secrets (quando habilitado) com fallback configurável; nunca logar conteúdo de segredo.

## Stacks e papéis
- Web/Proxy: Nginx/Traefik servindo frontend e roteando `/api` e `/ws`.
- Frontend: React + Vite (já no projeto). Futuro: build estático servido pelo proxy em produção.
- API: Node.js + Express + Prisma (já no projeto), expondo REST e o endpoint `/ws` (express-ws) para eventos.
- Fila/Cache/Locks: Redis central.
- Workers: BullMQ (já presente nas dependências) processando jobs pesados; repetir jobs via “repeatable jobs” do BullMQ em vez de cron interno.
- Automação (gateway tipo Koko): serviço Node dedicado (pode compartilhar a imagem do backend) executando SSH (ssh2), SNMP (net-snmp) e integrações HTTP. Se for necessária automação mais rica (Nornir/Netmiko/NAPALM), subir microserviço Python separado e comunicar via fila/API interna.
- Banco: PostgreSQL (substituir dev.db local em produção), manter Prisma como ORM.

## Filas, jobs e locks (BullMQ)
- Filas propostas:
  - `netbox-sync`: sincronizar tenants/sites/devices/IPs/credenciais; jobId por tenant (`netbox-sync:{tenantId}`) para deduplicar.
  - `oxidized-sync`: atualizar `router.db` e puxar estados; jobId por tenant.
  - `device-scan`: coleta SNMP/BGP/metadata por device; jobId `device-scan:{deviceId}`; limitar concorrência por POP/tenant.
  - `credential-check`: validar segredo/SSH por device; jobId `credential-check:{deviceId}`.
  - `connectivity-test`: ping/traceroute por device/target; jobId `connectivity:{deviceId}:{target}`.
- Padrões operacionais:
  - Backoff exponencial, até 3–5 tentativas; `removeOnComplete` com retenção curta e `removeOnFail` com retenção longa para inspeção.
  - Locks por device/POP via chaves Redis (ex.: `lock:device:{id}` com TTL) para evitar avalanche.
  - Rate limit global por fila e por host; limites menores para `device-scan` e `credential-check`.
  - Payload mínimo: `tenantId`, `deviceId`, `netboxId`, `targets`, `reason`, `requestedBy`.

## Observabilidade e segurança
- Logs estruturados com nível (info/warn/error) e correlação de jobId/requestId; anonimizar segredos; logger sugerido: Pino.
- Métricas: `prom-client` no backend/worker expondo `/metrics` (latência de job, taxa de erro, filas em andamento, locks ativos).
- Healthchecks: `/health` (API) e `/health/worker` (fila/Redis); alarmes para fila acumulada.
- Segredos: `.env` separados por serviço; preferir injeção via env/secret manager (Kubernetes) e uso do NetBox Secrets Plugin; nunca armazenar segredo em claro no banco.

## Orquestração (docker-compose → futuro K8s)
- Compose (produção): `web` (nginx), `frontend` (build estático ou servidor Next), `backend` (API + WS), `worker` (BullMQ), `scheduler` (BullMQ repeatable jobs), `automation` (opcional se separar SSH/SNMP), `redis`, `db`, `oxidized`, `checkmk/portainer` opcionais.
- Deploy atual pode reutilizar a mesma imagem do backend para `backend`, `worker` e `scheduler` (entrypoints diferentes).
- Migração para Kubernetes: deployments separados para `backend`, `worker`, `scheduler`, `automation`; Redis e Postgres gerenciados; ingress para web/api/ws; secrets em Secret/SealedSecret; HPA usando métricas de filas.

## Próximas ações
1) Implementar filas BullMQ descritas (estruturas, locks, métricas) e expor `/ws` com eventos de job.
2) Separar entrypoints de contêiner: `backend` (API/WS) e `worker` (BullMQ), com scheduler repeatable.
3) Substituir dev.db por PostgreSQL em produção e ajustar envs/docker-compose.
4) Endurecer segredos (envs separados, lint de logs sem segredos) e adicionar `/metrics` + `/health`.
5) Decidir se automação SSH/SNMP fica no worker Node ou se cria microserviço Python para Nornir/Netmiko.
