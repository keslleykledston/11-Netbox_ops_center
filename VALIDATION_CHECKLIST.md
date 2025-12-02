# ✅ Checklist de Validação - NetBox Ops Center

## 🎯 Objetivo
Validar as melhorias implementadas após migração para PostgreSQL e correções de bugs.

---

## 📋 **1. Verificar Serviços Docker**

```bash
docker compose ps
```

**Esperado**: Todos os containers devem estar `Up`:
- ✅ netbox-ops-center-proxy
- ✅ netbox-ops-center-frontend
- ✅ netbox-ops-center-backend
- ✅ netbox-ops-center-worker
- ✅ netbox-ops-center-scheduler
- ✅ netbox-ops-center-db (PostgreSQL)
- ✅ netbox-ops-center-redis
- ✅ netbox-ops-center-oxidized
- ✅ netbox-ops-center-portainer
- ⚠️ netbox-ops-center-checkmk (opcional)

---

## 📋 **2. Testar UI de Dispositivos**

### 2.1. Acessar a interface
1. Abra o navegador em `http://SEU_IP/`
2. Faça login (usuário padrão: `admin` / `Ops_pass_`)
3. Navegue até **Dispositivos**

### 2.2. Verificar se a listagem carrega
- ✅ A página deve carregar sem erros 504
- ✅ Dispositivos devem aparecer (se já sincronizados)
- ✅ **Não** deve haver lookup do CheckMK (desabilitado)

### 2.3. Abrir DevTools do navegador
- **Console (F12 → Console)**:
  - ⚠️ **NÃO** devem aparecer warnings do React Router v6
  - ✅ Confirmar que future flags estão ativos

- **Network (F12 → Network)**:
  - Request para `/api/devices` deve retornar **200 OK**
  - Response time deve ser < 2s (sem timeout 504)
  - Se houver erro, copiar payload e response

---

## 📋 **3. Validar Sincronização NetBox**

### 3.1. Configurar aplicação NetBox
1. Vá em **Aplicações** → **Adicionar Aplicação**
2. Configure:
   - **Nome**: `NetBox`
   - **URL**: `https://seu-netbox.com`
   - **API Key**: Seu token do NetBox
   - **Tenant Group Filter**: `K3G Solutions` (ou o slug correto do seu tenant group)

### 3.2. Disparar sincronização
1. Clique em **Sincronizar NetBox**
2. Aguarde o job completar (~30s a 2min dependendo da quantidade de dados)

### 3.3. Verificar resultados
- ✅ Dashboard deve mostrar **counters > 0**:
  - Devices Ativos: > 0
  - Tenants: > 0
  - Sites: > 0 (se aplicável)

### 3.4. Verificar filtros no NetBox
- ⚠️ Certifique-se que os dispositivos no NetBox têm:
  - **IP Primário** configurado
  - Pertencem ao **Tenant Group** correto (padrão: "K3G Solutions")
  - **Roles, Platforms, Device Types** configurados (se usar filtros)

### 3.5. Logs de debug (se necessário)
```bash
# Verificar logs do worker (onde roda o sync)
docker logs netbox-ops-center-worker -f

# Verificar logs do backend
docker logs netbox-ops-center-backend -f
```

---

## 📋 **4. Validar Banco PostgreSQL**

### 4.1. Verificar DATABASE_URL
```bash
docker exec netbox-ops-center-backend env | grep DATABASE_URL
```

**Esperado**:
```
DATABASE_URL=postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops
```

### 4.2. Conectar no banco (opcional)
```bash
docker exec -it netbox-ops-center-db psql -U netbox_ops -d netbox_ops
```

**Queries úteis**:
```sql
-- Ver quantas tabelas existem
\dt

-- Contar dispositivos
SELECT COUNT(*) FROM "Device";

-- Contar tenants
SELECT COUNT(*) FROM "Tenant";

-- Sair
\q
```

---

## 📋 **5. Validar Oxidized (Backups)**

### 5.1. Verificar se Oxidized está rodando
```bash
docker logs netbox-ops-center-oxidized --tail 50
```

### 5.2. Testar interface Oxidized
- Acesse: `http://SEU_IP:8888/` (porta externa) ou `http://SEU_IP/oxidized/` (via proxy)
- ✅ Deve mostrar lista de dispositivos gerenciados

### 5.3. Verificar sync Oxidized
1. Vá em **Backup** na UI
2. Verifique se há versões de configuração salvas
3. Teste a funcionalidade de **Diff** (comparar versões)

---

## 📋 **6. Validar Filas Redis (BullMQ)**

### 6.1. Verificar jobs enfileirados
```bash
docker exec -it netbox-ops-center-redis redis-cli

# Listar chaves de filas
KEYS bull:*

# Ver jobs pendentes na fila netbox-sync
LLEN bull:netbox-sync:waiting

# Ver jobs completados
LLEN bull:netbox-sync:completed

# Sair
exit
```

---

## 📋 **7. Opcional: CheckMK (Atualmente Desabilitado)**

⚠️ **Status**: Integração CheckMK foi **temporariamente desabilitada** devido a timeouts (504) na listagem de dispositivos.

### Opções futuras:
- **Opção A**: Reabilitar de forma assíncrona (job em background, não bloquear `/devices`)
- **Opção B**: Lazy load (carregar status CheckMK após a listagem)
- **Opção C**: Manter desabilitado

---

## 🐛 **Troubleshooting**

### Erro: "Dispositivos não aparecem após sync NetBox"
1. Verificar se `NETBOX_TENANT_GROUP_FILTER` está correto:
   ```bash
   docker exec netbox-ops-center-backend env | grep NETBOX_TENANT_GROUP_FILTER
   ```
2. Confirmar que os dispositivos no NetBox pertencem a esse Tenant Group
3. Verificar se têm IP primário configurado

### Erro: "504 Gateway Timeout na listagem"
1. Verificar se CheckMK está desabilitado:
   ```bash
   docker logs netbox-ops-center-backend | grep -i checkmk
   ```
2. Deve aparecer mensagens indicando que CheckMK está desabilitado

### Erro: "Warnings do React Router no console"
- ✅ **Resolvido**: Future flags adicionados em `src/App.tsx:36`
- Se ainda aparecer, fazer rebuild do frontend:
  ```bash
  docker compose restart frontend
  ```

### Erro: "Database connection failed"
1. Verificar se o container do PostgreSQL está rodando:
   ```bash
   docker compose ps db
   ```
2. Verificar logs:
   ```bash
   docker logs netbox-ops-center-db
   ```

---

## ✅ **Checklist Final**

- [ ] Todos os containers estão `Up`
- [ ] UI de dispositivos carrega sem timeout
- [ ] Sincronização NetBox funciona (counters > 0)
- [ ] Não há warnings do React Router no console
- [ ] DATABASE_URL aponta para PostgreSQL
- [ ] Oxidized está gerenciando backups
- [ ] Logs do backend/worker não mostram erros críticos

---

## 📊 **Resultados Esperados**

Se **todos os itens** acima estão ✅, a migração foi bem-sucedida e o sistema está pronto para uso!

### Melhorias Implementadas:
1. ✅ Migração de SQLite (dev.db) para PostgreSQL
2. ✅ Separação de containers (backend, worker, scheduler)
3. ✅ Integração CheckMK desabilitada (evita timeout)
4. ✅ Future flags do React Router (sem warnings)
5. ✅ Documentação atualizada (README, ARCHITECTURE_PLAN)
6. ✅ Scripts corrigidos (quick-diagnose.sh)

---

## 🔗 **Links Úteis**

- Dashboard: `http://SEU_IP/dashboard`
- Dispositivos: `http://SEU_IP/devices`
- Aplicações: `http://SEU_IP/applications`
- Backup: `http://SEU_IP/backup`
- Portainer: `http://SEU_IP/portainer/`
- Oxidized: `http://SEU_IP:8888/`

---

**Documentação completa**: [README.md](README.md)
**Arquitetura**: [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md)
**Changelog**: [CHANGELOG.md](CHANGELOG.md)
