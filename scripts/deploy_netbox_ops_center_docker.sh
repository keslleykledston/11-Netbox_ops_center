#!/usr/bin/env bash
# NetBox Ops Center installer
# - Escolhe Docker (com Portainer) ou bare-metal
# - Prepara ambiente, aplica correções e testa acesso web

set -euo pipefail

REPO_URL="https://github.com/keslleykledston/11-Netbox_ops_center.git"
DEFAULT_APP_DIR="/opt/netbox-ops-center"
DEFAULT_HTTP_PORT=80
APP_USER="netboxops"
PORTAINER_VOLUME="netbox_portainer_data"
DOCKER_GPG_KEY="/etc/apt/keyrings/docker.asc"
DOCKER_REPO_FILE="/etc/apt/sources.list.d/docker.list"
COMPOSE_FILE="docker-compose.yml"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { log "ERRO: $*"; exit 1; }
need_root() { [[ $EUID -eq 0 ]] || fail "Execute como root"; }
need_debian() { grep -qi debian /etc/os-release || fail "Script suportado apenas em Debian"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatório: $1"; }

prompt_choice() {
  local choice=""
  echo "Modo de instalação:";
  echo "  1) Docker (instala Docker + Portainer + stack)";
  echo "  2) Bare-metal (Node 20 + systemd)";
  while [[ -z "$choice" ]]; do
    read -rp "Informe 1 ou 2: " ans || true
    case "$ans" in
      1) choice="docker" ;;
      2) choice="bare" ;;
      *) echo "Opção inválida" ;;
    esac
  done
  INSTALL_MODE="$choice"
}

ask_values() {
  read -rp "Diretório de instalação [${DEFAULT_APP_DIR}]: " APP_DIR
  APP_DIR=${APP_DIR:-$DEFAULT_APP_DIR}
  mkdir -p "$APP_DIR"
  EXTERNAL_PORT=${DEFAULT_HTTP_PORT}
}

ensure_packages() {
  need_cmd apt-get
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git lsb-release unzip sudo
}

install_docker_engine() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker já presente"
    return
  fi
  log "Instalando Docker Engine..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o "$DOCKER_GPG_KEY"
  chmod a+r "$DOCKER_GPG_KEY"
  cat >"$DOCKER_REPO_FILE" <<EOFREPO
deb [arch=$(dpkg --print-architecture) signed-by=$DOCKER_GPG_KEY] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable
EOFREPO
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_portainer() {
  log "Instalando Portainer..."
  docker volume create "$PORTAINER_VOLUME" >/dev/null
  docker rm -f portainer >/dev/null 2>&1 || true
  docker run -d --name portainer --restart=always \
    -p 8000:8000 -p 9443:9443 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$PORTAINER_VOLUME":/data \
    portainer/portainer-ce:latest >/dev/null
}

ensure_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    fail "Docker Compose não disponível"
  fi
}

clone_repo() {
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Atualizando repositório existente..."
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" reset --hard origin/main
  else
    log "Clonando repositório para $APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
  fi
}

write_envs() {
  local default_api="http://localhost:8888"
  local default_router="/etc/oxidized/router.db"
  if [[ $INSTALL_MODE == docker ]]; then
    default_api="http://host.docker.internal:8888"
    default_router="/host-oxidized/router.db"
  fi
  if [[ ! -f "$APP_DIR/.env" ]]; then
    cat >"$APP_DIR/.env" <<'ENVEOF'
VITE_USE_BACKEND=true
VITE_API_URL=/api
VITE_HUB_API_URL=/hub-api
API_SERVER_URL=http://localhost:4000
SNMP_SERVER_URL=http://localhost:3001
DATABASE_URL=postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops
PORT=4000
JWT_SECRET=change_me
CRED_ENCRYPTION_KEY=change_me
NETBOX_URL=http://localhost:8000
NETBOX_TOKEN=
SNMP_SERVER_PORT=3001
SNMP_MAX_REPETITIONS=20
SNMP_GLOBAL_TIMEOUT_MS=60000
NETBOX_TENANT_GROUP_FILTER=K3G Solutions
OXIDIZED_API_URL=__OX_URL__
OXIDIZED_ROUTER_DB=__OX_ROUTER__
ENVEOF
    sed -i "s#__OX_URL__#${default_api}#" "$APP_DIR/.env"
    sed -i "s#__OX_ROUTER__#${default_router}#" "$APP_DIR/.env"
  fi
}

create_compose_file() { :; }

wait_for_http() {
  local name=$1 url=$2 timeout=${3:-180} elapsed=0
  until curl -sSf -o /dev/null "$url"; do
    sleep 5
    elapsed=$((elapsed+5))
    if (( elapsed >= timeout )); then
      fail "$name não respondeu em ${timeout}s"
    fi
  done
}

start_docker_stack() {
  if [[ $INSTALL_MODE == docker ]]; then
    ensure_oxidized_tree
  fi
  log "Subindo stack Docker..."
  (cd "$APP_DIR" && $COMPOSE up -d --remove-orphans)
  wait_for_http "NetBox Ops Center" "http://localhost:${EXTERNAL_PORT}" 180
  (cd "$APP_DIR" && $COMPOSE ps)
}

install_node_runtime() {
  if command -v node >/dev/null 2>&1 && node -v | grep -qE '^v2[0-9]'; then
    log "Node $(node -v) já instalado"
    return
  fi
  log "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs build-essential
}

ensure_app_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$APP_DIR" "$APP_USER"
  fi
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
}

run_as_app() {
  sudo -u "$APP_USER" -H bash -c "$1"
}

install_bare_dependencies() {
  log "Instalando dependências npm (bare-metal)..."
  run_as_app "cd '$APP_DIR' && npm install"
  run_as_app "cd '$APP_DIR' && npm run server:install"
  run_as_app "cd '$APP_DIR' && npm run db:migrate"
  run_as_app "cd '$APP_DIR' && npm run prisma:generate"
}

ensure_oxidized_tree() {
  local host_dir="/etc/oxidized"
  if [[ ! -d "$host_dir" ]]; then
    log "Criando diretório $host_dir"
    mkdir -p "$host_dir"
  fi
  if [[ ! -f "$host_dir/router.db" ]]; then
    cat >"$host_dir/router.db" <<'ROUTER'
# Managed entries serão controlados automaticamente
ROUTER
  fi
}

setup_systemd() {
  local npm_bin
  npm_bin=$(command -v npm)
  cat >/etc/systemd/system/netbox-ops-center.service <<SERVICE
[Unit]
Description=NetBox Ops Center (bare-metal)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=development
ExecStart=$npm_bin run dev:stack
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
  systemctl daemon-reload
  systemctl enable --now netbox-ops-center.service
  wait_for_http "NetBox Ops Center" "http://localhost:${EXTERNAL_PORT}" 180
}

summary_docker() {
  local host_ip
  host_ip=$(hostname -I | awk '{print $1}')
  log "Portainer: https://${host_ip}:9443"
  log "NetBox Ops Center (Docker): http://${host_ip}:${EXTERNAL_PORT}"
  log "Comandos:"
  log "  docker compose -f ${APP_DIR}/${COMPOSE_FILE} logs -f"
  log "  docker compose -f ${APP_DIR}/${COMPOSE_FILE} down"
}

summary_bare() {
  local host_ip
  host_ip=$(hostname -I | awk '{print $1}')
  log "Serviço systemd ativo (netbox-ops-center.service)"
  log "Acesso web: http://${host_ip}:8080"
  log "Logs: journalctl -u netbox-ops-center -f"
}

main() {
  need_root
  need_debian
  ensure_packages
  prompt_choice
  ask_values
  clone_repo
  write_envs
  if [[ $INSTALL_MODE == docker ]]; then
    install_docker_engine
    install_portainer
    ensure_compose
    create_compose_file
    start_docker_stack
    summary_docker
  else
    install_node_runtime
    ensure_app_user
    install_bare_dependencies
    setup_systemd
    summary_bare
  fi
}

main "$@"
