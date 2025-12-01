# Guia de Intervalos de Backup - Oxidized Proxy

## Configurações de Intervalo

O Oxidized suporta diferentes intervalos de backup. Aqui estão as opções mais comuns:

| Intervalo | Segundos | Uso Recomendado |
|-----------|----------|-----------------|
| 15 minutos | 900 | Ambientes críticos, mudanças frequentes |
| 30 minutos | 1800 | **Padrão recomendado** - Equilíbrio entre frequência e carga |
| 1 hora | 3600 | Ambientes estáveis, muitos dispositivos |
| 2 horas | 7200 | Dispositivos com mudanças raras |
| 4 horas | 14400 | Apenas monitoramento de mudanças ocasionais |

## Novos Proxies

Para novos proxies instalados após esta atualização, o intervalo padrão é **30 minutos (1800 segundos)**.

## Ajustar Intervalo em Proxies Existentes

### Método 1: Edição Manual (Recomendado)

1. **Conecte-se ao servidor do proxy via SSH:**
```bash
ssh root@ip-do-proxy
```

2. **Edite o arquivo de configuração:**
```bash
nano /home/oxidized/.config/oxidized/config
```

3. **Localize a linha `interval:` e altere o valor:**
```yaml
interval: 1800  # 30 minutos
```

4. **Reinicie o serviço:**
```bash
systemctl restart oxidized-proxy
```

5. **Verifique se está funcionando:**
```bash
systemctl status oxidized-proxy
journalctl -u oxidized-proxy -f
```

### Método 2: Script de Atualização Remota

Crie um script para atualizar múltiplos proxies de uma vez:

```bash
#!/bin/bash
# update-oxidized-interval.sh

PROXY_IPS="192.168.1.10 192.168.2.10 192.168.3.10"
NEW_INTERVAL="1800"  # 30 minutos

for IP in $PROXY_IPS; do
  echo "Atualizando proxy em $IP..."
  ssh root@$IP <<EOF
    sed -i "s/^interval:.*/interval: $NEW_INTERVAL/" /home/oxidized/.config/oxidized/config
    systemctl restart oxidized-proxy
    echo "Proxy $IP atualizado para intervalo de $NEW_INTERVAL segundos"
EOF
done
```

### Método 3: Ansible Playbook (Para Múltiplos Proxies)

```yaml
---
- name: Atualizar intervalo Oxidized em todos os proxies
  hosts: oxidized_proxies
  become: yes
  vars:
    oxidized_interval: 1800

  tasks:
    - name: Atualizar intervalo no config
      lineinfile:
        path: /home/oxidized/.config/oxidized/config
        regexp: '^interval:'
        line: "interval: {{ oxidized_interval }}"
        backup: yes

    - name: Reiniciar serviço Oxidized
      systemd:
        name: oxidized-proxy
        state: restarted

    - name: Aguardar serviço iniciar
      wait_for:
        port: 8888
        delay: 5
        timeout: 30
```

Execute com:
```bash
ansible-playbook -i inventory update-oxidized-interval.yml
```

## Verificar Intervalo Atual

Para verificar o intervalo configurado em um proxy:

```bash
ssh root@ip-do-proxy "grep '^interval:' /home/oxidized/.config/oxidized/config"
```

Ou via API REST do Oxidized:
```bash
curl http://ip-do-proxy:8888/node/stats
```

## Monitoramento de Backups

### Verificar Último Backup

```bash
# Via SSH
ssh oxidized@ip-do-proxy "cd /home/oxidized/backups && git log --oneline -10"

# Via API
curl http://ip-do-proxy:8888/nodes
```

### Logs de Backup

```bash
# Ver logs em tempo real
ssh root@ip-do-proxy "journalctl -u oxidized-proxy -f"

# Filtrar apenas sucessos
ssh root@ip-do-proxy "journalctl -u oxidized-proxy | grep 'successfully backed up'"

# Filtrar apenas erros
ssh root@ip-do-proxy "journalctl -u oxidized-proxy | grep -i error"
```

## Otimização de Performance

### Para Muitos Dispositivos (>100)

Se você tem muitos dispositivos, considere:

1. **Aumentar threads:**
```yaml
threads: 50  # ou mais
```

2. **Aumentar timeout:**
```yaml
timeout: 30
```

3. **Distribuir em múltiplos proxies:**
   - Divida dispositivos por região/site
   - Use um proxy por filial

### Para Poucos Dispositivos (<20)

Se tem poucos dispositivos, pode usar intervalos menores:

```yaml
interval: 900  # 15 minutos
threads: 10
timeout: 20
```

## Troubleshooting

### Backup não está executando

1. **Verifique se o serviço está rodando:**
```bash
systemctl status oxidized-proxy
```

2. **Verifique erros nos logs:**
```bash
journalctl -u oxidized-proxy --since "1 hour ago"
```

3. **Teste conectividade com dispositivos:**
```bash
ssh oxidized@ip-do-dispositivo
```

### Backups demorando muito

Se os backups estão demorando mais que o intervalo configurado:

1. **Aumente o número de threads**
2. **Divida dispositivos entre múltiplos proxies**
3. **Aumente o timeout se necessário**

## Boas Práticas

1. ✅ Use 30 minutos como padrão para a maioria dos casos
2. ✅ Monitore a carga do servidor do proxy
3. ✅ Configure alertas para backups falhados
4. ✅ Mantenha logs por pelo menos 7 dias
5. ✅ Teste mudanças em ambiente não-produtivo primeiro
6. ✅ Documente intervalos específicos por proxy/site

## Referência Rápida de Comandos

```bash
# Ver config atual
cat /home/oxidized/.config/oxidized/config

# Testar config
su - oxidized -c "oxidized --dry-run"

# Reiniciar serviço
systemctl restart oxidized-proxy

# Ver status
systemctl status oxidized-proxy

# Ver logs
journalctl -u oxidized-proxy -f

# Forçar backup manual de um dispositivo
curl -X POST http://localhost:8888/node/next/nome-do-dispositivo
```
