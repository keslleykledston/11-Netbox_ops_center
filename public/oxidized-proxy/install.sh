#!/bin/bash
set -e

# Oxidized Proxy Installation Script
# Usage: curl -sSL http://central-url/oxidized-proxy/install.sh | bash -s -- SITE_ID CENTRAL_URL API_KEY [GIT_REPO]

SITE_ID="${1}"
CENTRAL_URL="${2}"
API_KEY="${3}"
GIT_REPO="${4:-}"

if [ -z "$SITE_ID" ] || [ -z "$CENTRAL_URL" ] || [ -z "$API_KEY" ]; then
  echo "Erro: Argumentos insuficientes"
  echo "Uso: $0 SITE_ID CENTRAL_URL API_KEY [GIT_REPO]"
  exit 1
fi

echo "========================================="
echo "Oxidized Proxy - Instalação Automática"
echo "========================================="
echo "Site ID: $SITE_ID"
echo "Central URL: $CENTRAL_URL"
echo "Git Repo: ${GIT_REPO:-Nenhum}"
echo "========================================="

# Detectar sistema operacional
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "Erro: Sistema operacional não identificado"
  exit 1
fi

echo "Sistema operacional detectado: $OS"

# Instalar dependências baseado no SO
install_dependencies() {
  case $OS in
    ubuntu|debian)
      echo "Instalando dependências no Debian/Ubuntu..."
      apt-get update
      apt-get install -y ruby ruby-dev libsqlite3-dev cmake pkg-config libssl-dev git
      gem install oxidized oxidized-script oxidized-web
      ;;
    centos|rhel|rocky|almalinux)
      echo "Instalando dependências no CentOS/RHEL/Rocky..."
      yum install -y epel-release
      yum install -y ruby ruby-devel sqlite-devel cmake openssl-devel git gcc gcc-c++ make
      gem install oxidized oxidized-script oxidized-web
      ;;
    *)
      echo "Erro: SO $OS não suportado automaticamente"
      echo "Por favor instale manualmente: ruby, oxidized, oxidized-script, oxidized-web"
      exit 1
      ;;
  esac
}

# Verificar se oxidized já está instalado
if ! command -v oxidized &> /dev/null; then
  echo "Oxidized não encontrado, instalando..."
  install_dependencies
else
  echo "Oxidized já está instalado"
fi

# Criar usuário oxidized se não existir
if ! id oxidized &> /dev/null; then
  echo "Criando usuário oxidized..."
  useradd -r -m -d /home/oxidized -s /bin/bash oxidized
fi

# Criar diretórios
echo "Criando estrutura de diretórios..."
mkdir -p /home/oxidized/.config/oxidized
mkdir -p /home/oxidized/backups
chown -R oxidized:oxidized /home/oxidized

# Configurar Git se fornecido
GIT_CONFIG=""
if [ -n "$GIT_REPO" ]; then
  echo "Configurando repositório Git..."
  GIT_CONFIG="
output:
  git:
    user: Oxidized Proxy
    email: oxidized@${SITE_ID}
    repo: /home/oxidized/backups
    remote_repo: ${GIT_REPO}
"

  # Inicializar repositório Git
  su - oxidized -c "cd /home/oxidized/backups && git init && git config user.name 'Oxidized Proxy' && git config user.email 'oxidized@${SITE_ID}'"

  # Configurar remote se for SSH
  if [[ "$GIT_REPO" == git@* ]]; then
    echo "ATENÇÃO: Configure a chave SSH em /home/oxidized/.ssh/id_rsa para push automático"
  fi
fi

# Obter endpoint local
LOCAL_IP=$(hostname -I | awk '{print $1}')
ENDPOINT="http://${LOCAL_IP}:8888"

# Criar arquivo de configuração
echo "Criando configuração do Oxidized..."
cat > /home/oxidized/.config/oxidized/config << EOF
---
username: admin
password: admin
model: ios
resolve_dns: false
interval: 1800
use_syslog: false
debug: false
threads: 30
timeout: 20
retries: 3
prompt: !ruby/regexp /^([\w.@-]+[#>]\s?)$/
rest: 0.0.0.0:8888
next_adds_job: false

source:
  default: http
  http:
    url: ${CENTRAL_URL}/api/v1/oxidized-proxy/${SITE_ID}/devices
    scheme: http
    delimiter: !ruby/regexp /:/
    map:
      name: name
      model: model
      username: username
      password: password
    headers:
      X-API-Key: ${API_KEY}

${GIT_CONFIG}

hooks:
  backup_status:
    type: exec
    events: [node_success, node_fail, post_store]
    cmd: 'curl -X POST ${CENTRAL_URL}/api/v1/oxidized-proxy/${SITE_ID}/status -H "X-API-Key: ${API_KEY}" -H "Content-Type: application/json" -d "{\"event\":\"\$OX_EVENT\",\"node\":\"\$OX_NODE_NAME\",\"status\":\"\$?\",\"message\":\"\$OX_NODE_MSG\"}"'
EOF

chown oxidized:oxidized /home/oxidized/.config/oxidized/config

# Criar serviço systemd
echo "Criando serviço systemd..."
cat > /etc/systemd/system/oxidized-proxy.service << EOF
[Unit]
Description=Oxidized Network Device Backup Proxy
After=network.target

[Service]
Type=simple
User=oxidized
Group=oxidized
WorkingDirectory=/home/oxidized
ExecStart=/usr/local/bin/oxidized
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Recarregar systemd e iniciar serviço
echo "Iniciando serviço..."
systemctl daemon-reload
systemctl enable oxidized-proxy
systemctl restart oxidized-proxy

# Aguardar serviço iniciar
sleep 5

# Registrar proxy no central
echo "Registrando proxy no servidor central..."
curl -X POST "${CENTRAL_URL}/api/v1/oxidized-proxy/register" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"site_id\":\"${SITE_ID}\",\"endpoint\":\"${ENDPOINT}\"}" || {
  echo "AVISO: Falha ao registrar proxy automaticamente"
  echo "Execute manualmente:"
  echo "curl -X POST '${CENTRAL_URL}/api/v1/oxidized-proxy/register' -H 'X-API-Key: ${API_KEY}' -H 'Content-Type: application/json' -d '{\"site_id\":\"${SITE_ID}\",\"endpoint\":\"${ENDPOINT}\"}'"
}

echo ""
echo "========================================="
echo "Instalação concluída!"
echo "========================================="
echo "Status: systemctl status oxidized-proxy"
echo "Logs: journalctl -u oxidized-proxy -f"
echo "API Web: http://$(hostname -I | awk '{print $1}'):8888"
echo "========================================="
