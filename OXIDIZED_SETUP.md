# Configuração do Oxidized - Documentação Completa

## Visão Geral

O Oxidized é uma ferramenta de backup de configurações de dispositivos de rede que faz parte da solução Netbox Ops Center. Esta documentação detalha como o Oxidized foi configurado e como resolver problemas comuns.

## Arquitetura

### Containers e Volumes

- **Container**: `netbox-ops-center-oxidized`
- **Imagem**: `oxidized/oxidized:latest`
- **Volume**: `oxidized_config` montado em `/home/oxidized/.config/oxidized`
- **Porta**: 8888 (API REST)

### Integração com a Aplicação

- O container `netbox-ops-center-app` também monta o volume `oxidized_config` em `/host-oxidized`
- A aplicação gerencia o arquivo `router.db` que contém a lista de dispositivos
- O Oxidized lê este arquivo e realiza backups automaticamente

## Configuração do Oxidized

### Arquivo de Configuração (`config`)

Localização: `/home/oxidized/.config/oxidized/config`

```yaml
---
username: username
password: password
model: ios
resolve_dns: false
interval: 3600
debug: false
run_once: false
use_syslog: false
threads: 30
use_max_threads: false
timeout: 20
timelimit: 300
retries: 3
prompt: !ruby/regexp /^([\w.@-]+[#>]\s?)$/
next_adds_job: true
pid: "/home/oxidized/.config/oxidized/pid"
crash:
  directory: "/home/oxidized/.config/oxidized/crashes"
  hostnames: false
stats:
  history_size: 10
input:
  default: ssh, telnet
  debug: false
  ssh:
    secure: false
  ftp:
    passive: true
  utf8_encoded: true
output:
  default: file
  file:
    directory: "/home/oxidized/.config/oxidized/configs"
rest: 0.0.0.0:8888
source:
  default: csv
  csv:
    file: "/home/oxidized/.config/oxidized/router.db"
    delimiter: !ruby/regexp /:/
    map:
      name: 0
      model: 1
      username: 2
      password: 3
    gpg: false
model_map:
  juniper: junos
  cisco: ios
  mikrotik: routeros
```

### Arquivo router.db

Formato: `hostname:model:username:password`

Exemplo:
```
# Format: hostname:model:username:password
# Placeholder - will be replaced when devices are enabled for backup
placeholder.local:ios:admin:password
router1.example.com:ios:admin:senha123
switch1.example.com:ios:admin:senha123
```

**Importante**: O Oxidized requer pelo menos 1 dispositivo no router.db para iniciar. Por isso, um dispositivo placeholder é incluído.

## Problema Comum: "Oxidized API indisponível"

### Causa Raiz

O container Oxidized roda com o usuário `oxidized` (uid 30000), mas anteriormente o volume estava montado em `/root/.config/oxidized`, causando problemas de permissão e path.

### Solução Aplicada

1. **Corrigido o volume mount no docker-compose.yml**:
   ```yaml
   volumes:
     - oxidized_config:/home/oxidized/.config/oxidized  # Caminho correto
   ```

2. **Criado estrutura de diretórios**:
   - `/home/oxidized/.config/oxidized/` (diretório principal)
   - `/home/oxidized/.config/oxidized/configs/` (backups)
   - `/home/oxidized/.config/oxidized/crashes/` (logs de erro)

3. **Configurado arquivo router.db com placeholder**:
   - Oxidized não inicia com lista vazia de nodes
   - Placeholder evita crash na inicialização
   - A aplicação substitui o conteúdo quando dispositivos são habilitados

## Script de Inicialização

O script `scripts/init-oxidized.sh` foi criado para automatizar a configuração:

```bash
#!/bin/bash
# Inicializa o volume do Oxidized com configuração padrão
```

Este script:
1. Cria o arquivo de configuração
2. Cria os diretórios necessários
3. Inicializa o router.db com placeholder
4. Define permissões corretas

## Verificação de Funcionamento

### 1. Verificar se o container está rodando

```bash
docker ps | grep oxidized
```

Saída esperada:
```
netbox-ops-center-oxidized   Up X minutes   0.0.0.0:8888->8888/tcp
```

### 2. Verificar logs do Oxidized

```bash
docker logs netbox-ops-center-oxidized --tail 20
```

Saída esperada deve conter:
```
Oxidized-web server listening on 0.0.0.0:8888
```

### 3. Testar API REST

```bash
curl http://localhost:8888/nodes.json
```

Deve retornar JSON com a lista de nodes.

### 4. Testar integração com a aplicação

Na interface web:
1. Vá para **Aplicações**
2. Adicione uma nova aplicação:
   - Nome: `Oxidized`
   - URL: `http://oxidized:8888`
   - API Key: `none` (ou qualquer valor)
3. Clique em "Testar Conexão"
4. Deve mostrar "Conexão bem-sucedida"

## Fluxo de Backup

1. **Usuário habilita backup para um dispositivo** na aba "Backup" da interface
2. **Aplicação atualiza o router.db** com as credenciais do dispositivo
3. **Oxidized detecta mudanças** e adiciona o dispositivo à fila
4. **Backup é executado** no intervalo configurado (padrão: 3600 segundos = 1 hora)
5. **Configurações são salvas** em `/home/oxidized/.config/oxidized/configs/`

## Resolução de Problemas

### Oxidized crashando continuamente

**Sintoma**: Logs mostram "source returns no usable nodes"

**Solução**:
```bash
# Verificar se router.db tem pelo menos 1 dispositivo
docker exec netbox-ops-center-oxidized cat /home/oxidized/.config/oxidized/router.db

# Se estiver vazio, adicionar placeholder
docker exec netbox-ops-center-oxidized sh -c 'echo "placeholder.local:ios:admin:password" > /home/oxidized/.config/oxidized/router.db'

# Reiniciar
docker compose restart oxidized
```

### API não responde

**Sintoma**: curl http://localhost:8888 retorna "Connection refused"

**Solução**:
```bash
# Verificar se REST API está habilitada no config
docker exec netbox-ops-center-oxidized grep "rest:" /home/oxidized/.config/oxidized/config

# Deve mostrar: rest: 0.0.0.0:8888

# Se não estiver, recriar config usando o script de inicialização
./scripts/init-oxidized.sh
docker compose restart oxidized
```

### Permissões incorretas

**Sintoma**: Erros de "Permission denied" nos logs

**Solução**:
```bash
# Ajustar permissões no volume
docker run --rm -v 11-netbox_ops_center_oxidized_config:/data alpine chmod -R 755 /data
docker compose restart oxidized
```

## Manutenção

### Visualizar backups salvos

```bash
docker exec netbox-ops-center-oxidized ls -lh /home/oxidized/.config/oxidized/configs/
```

### Limpar crashfiles antigos

```bash
docker exec netbox-ops-center-oxidized rm -rf /home/oxidized/.config/oxidized/crashes/*
```

### Atualizar imagem do Oxidized

```bash
docker compose pull oxidized
docker compose up -d oxidized
```

## Variáveis de Ambiente

No `docker-compose.yml` (container app):

- `OXIDIZED_API_URL`: URL da API do Oxidized (http://oxidized:8888)
- `OXIDIZED_ROUTER_DB`: Caminho para o router.db montado (/host-oxidized/router.db)

## Referências

- [Documentação Oficial do Oxidized](https://github.com/ytti/oxidized)
- [Configuração CSV Source](https://github.com/ytti/oxidized#csv-source)
- [REST API](https://github.com/ytti/oxidized#rest-api)
