# Sincronização Automática - Oxidized Proxy

## 📋 Visão Geral

O sistema implementa sincronização **automática e em tempo real** entre a aplicação NetBox Ops Center e os proxies Oxidized. Sempre que um dispositivo é modificado, o proxy correspondente é notificado instantaneamente para atualizar sua configuração.

## 🔄 Sincronização Automática

### Eventos que Disparam Sincronização

A sincronização automática ocorre nos seguintes casos:

#### 1. **Criação de Dispositivo** (`POST /devices`)
- ✅ Quando `backupEnabled: true`
- Notifica o proxy atribuído (ou todos os proxies do tenant)
- Ação: `create`

#### 2. **Atualização de Dispositivo** (`PATCH /devices/:id`)
Dispara sincronização quando há mudança em:
- ✅ `ipAddress` - IP do dispositivo
- ✅ `sshPort` - Porta SSH
- ✅ `username` - Nome de usuário
- ✅ `password` - Senha de acesso
- ✅ `name` - Nome do dispositivo
- ✅ `backupEnabled` - Status de backup
- ✅ `oxidizedProxyId` - Mudança de proxy

#### 3. **Atualização de Credenciais** (`PATCH /devices/:id/credentials`)
- ✅ Quando `username` é alterado
- ✅ Quando `password` é alterado

#### 4. **Exclusão de Dispositivo** (`DELETE /devices/:id`)
- ✅ Quando `backupEnabled: true`
- Remove dispositivo do Oxidized

## ⚡ Como Funciona

### Fluxo de Sincronização

```
┌─────────────────┐
│ Usuário altera  │
│   dispositivo   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API NetBox     │
│  Ops Center     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ notifyOxidized  │
│    Proxies()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ POST /reload    │────────────┐
│ ao proxy        │            │
└─────────────────┘            │
         │                     │
         ▼                     │
┌─────────────────┐            │
│ Oxidized busca  │◄───────────┘
│ nova config via │
│ API do NetBox   │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ Backup com      │
│ novos dados     │
└─────────────────┘
```

### Endpoints do Oxidized Utilizados

1. **`POST /reload`** - Recarrega configuração do Oxidized
   - Força o Oxidized a buscar nova lista de dispositivos
   - Timeout: 5 segundos

2. **`POST /node/next/[device_name]`** - Força backup imediato
   - Usado em atualizações (`action: 'update'`)
   - Dispara backup do dispositivo sem esperar intervalo
   - Timeout: 5 segundos

## 🎯 Sincronização Manual

Além da sincronização automática, você pode forçar manualmente:

### Interface Web

#### Sincronizar Proxy Individual
1. Acesse "Oxidized Proxies"
2. Clique no ícone de raio (⚡) do proxy desejado
3. O proxy será sincronizado imediatamente

#### Sincronizar Todos os Proxies
1. Acesse "Oxidized Proxies"
2. Clique em "Sincronizar Todos" no topo da página
3. Todos os proxies ativos serão sincronizados

### Via API

```bash
# Sincronizar proxy específico
curl -X POST http://localhost:4000/oxidized-proxy/1/sync \
  -H "Authorization: Bearer YOUR_TOKEN"

# Sincronizar todos os proxies do tenant
curl -X POST http://localhost:4000/oxidized-proxy/sync-all \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📝 Logs e Monitoramento

### Logs do Backend

Todos os eventos de sincronização são registrados:

```bash
# Ver logs de sincronização
docker logs netbox-ops-center-app | grep OXIDIZED

# Exemplos de logs:
[OXIDIZED] Notified proxy Filial SP (http://192.168.1.10:8888) - Action: update
[OXIDIZED] Failed to reload proxy Filial RJ: Connection timeout
```

### Logs do Proxy Oxidized

No servidor do proxy:

```bash
# Ver logs em tempo real
journalctl -u oxidized-proxy -f

# Filtrar por reload
journalctl -u oxidized-proxy | grep reload

# Ver último reload
journalctl -u oxidized-proxy | grep reload | tail -1
```

## 🔍 Troubleshooting

### Sincronização não está funcionando

1. **Verificar status do proxy**
```bash
curl http://ip-do-proxy:8888/
```

2. **Verificar conectividade**
```bash
# Do servidor central
curl -X POST http://ip-do-proxy:8888/reload
```

3. **Verificar logs do backend**
```bash
docker logs netbox-ops-center-app | grep OXIDIZED | tail -20
```

4. **Verificar se proxy está ativo**
- Status deve ser `active` no painel
- `endpoint` deve estar preenchido

### Erro "Proxy não tem endpoint configurado"

O proxy precisa se registrar primeiro:

```bash
# No servidor do proxy, executar manualmente:
curl -X POST http://central-url/api/v1/oxidized-proxy/register \
  -H "X-API-Key: API_KEY_DO_PROXY" \
  -H "Content-Type: application/json" \
  -d '{"site_id":"site-id","endpoint":"http://IP:8888"}'
```

### Timeout na sincronização

Se os timeouts forem frequentes:

1. **Aumentar timeout no código** (opcional)
   - Editar `server/src/index.js`
   - Mudar `AbortSignal.timeout(5000)` para valor maior

2. **Verificar latência de rede**
```bash
ping ip-do-proxy
```

3. **Verificar carga do proxy**
```bash
ssh root@ip-do-proxy
top
```

## 🎓 Boas Práticas

### ✅ Recomendações

1. **Mantenha proxies próximos aos dispositivos**
   - Menor latência na coleta
   - Sincronização mais rápida

2. **Configure alertas**
   - Monitore logs de falha de sincronização
   - Configure webhook para notificações

3. **Use backup automático habilitado apenas quando necessário**
   - Evita sincronizações desnecessárias
   - Reduz carga nos proxies

4. **Teste sincronização após mudanças**
   - Use botão manual após alterações críticas
   - Verifique logs para confirmar

### ⚠️ Evite

1. ❌ **Não desabilite backup sem motivo**
   - Perde sincronização automática
   - Dispositivo fica sem backup

2. ❌ **Não use mesmo proxy para muitos sites remotos**
   - Latência alta
   - Falhas de sincronização

3. ❌ **Não ignore erros de sincronização**
   - Proxies podem ficar desatualizados
   - Backups podem falhar

## 📊 Métricas de Sincronização

### Resposta de Sincronização Individual

```json
{
  "success": true,
  "message": "Proxy Filial SP sincronizado com sucesso",
  "endpoint": "http://192.168.1.10:8888"
}
```

### Resposta de Sincronização em Massa

```json
{
  "success": true,
  "total": 5,
  "synced": 4,
  "results": [
    {
      "proxyId": 1,
      "proxyName": "Filial SP",
      "success": true,
      "status": 200
    },
    {
      "proxyId": 2,
      "proxyName": "Filial RJ",
      "success": false,
      "error": "Connection timeout"
    }
  ]
}
```

## 🔧 Configuração Avançada

### Desabilitar Sincronização Automática (não recomendado)

Se por algum motivo você quiser desabilitar a sincronização automática:

1. Editar `server/src/index.js`
2. Comentar as chamadas para `notifyOxidizedProxies()`
3. Reiniciar aplicação

**⚠️ Atenção:** Você precisará sincronizar manualmente sempre que alterar dispositivos!

### Webhook Personalizado

Para integrar com sistemas de monitoramento:

```javascript
// Adicionar em server/src/index.js após notifyOxidizedProxies()
if (result.success) {
  // Enviar para sistema de monitoramento
  fetch('http://seu-webhook.com/oxidized-sync', {
    method: 'POST',
    body: JSON.stringify({
      deviceId,
      action,
      timestamp: new Date(),
      results: result.results
    })
  });
}
```

## 📚 Referência de API

### Backend Endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/oxidized-proxy/:id/sync` | POST | Sincroniza proxy específico |
| `/oxidized-proxy/sync-all` | POST | Sincroniza todos os proxies |

### Oxidized REST API

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/reload` | POST | Recarrega configuração |
| `/node/next/:name` | POST | Força backup do dispositivo |
| `/nodes` | GET | Lista dispositivos |
| `/node/show/:name` | GET | Detalhes do dispositivo |

## 💡 Dicas de Performance

1. **Latência baixa é crítica**
   - Proxies devem responder em < 1s
   - Use rede local quando possível

2. **Limite de dispositivos por proxy**
   - Recomendado: até 100 dispositivos
   - Acima disso, divida em múltiplos proxies

3. **Monitore carga do Oxidized**
   - CPU deve ficar < 50%
   - Memória RAM: mínimo 1GB livre

4. **Sincronizações em massa**
   - Use fora de horário de pico
   - Evite sobrecarga simultânea
