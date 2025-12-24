#!/usr/bin/env bash
# NetBox Ops Center – Installer (Docker or Bare-metal)
# Usage (interactive):
#   ./scripts/install_netbox_ops_center.sh
# Non-interactive:
#   MODE=docker APP_DIR=/opt/11-Netbox_ops_center PORT=58080 ./scripts/install_netbox_ops_center.sh -y

set -euo pipefail

DEFAULT_APP_DIR="${APP_DIR:-/opt/11-Netbox_ops_center}"
DEFAULT_PORT="${PORT:-58080}"
ASSUME_YES=false

while [[ ${1:-} ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true ;;
    -m|--mode) MODE="${2:-}"; shift ;;
    -d|--dir) DEFAULT_APP_DIR="${2:-}"; shift ;;
    -p|--port) DEFAULT_PORT="${2:-}"; shift ;;
  esac
  shift || true
done

need_cmd() { command -v "$1" >/dev/null 2>&1 || return 1; }
log() { printf "%s\n" "$*"; }
ok() { printf "[OK] %s\n" "$*"; }
warn() { printf "[WARN] %s\n" "$*"; }
err() { printf "[ERR] %s\n" "$*"; }

prompt() {
  local msg="$1"; local def="${2:-}"; local ans
  if $ASSUME_YES; then
    echo "${def}"
    return 0
  fi
  read -r -p "${msg} [${def}] > " ans || true
  echo "${ans:-$def}"
}

install_docker_and_compose() {
  if ! need_cmd docker; then
    warn "Docker not found. Installing (Debian/Ubuntu)..."
    if need_cmd apt-get; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y || true
      apt-get install -y ca-certificates curl gnupg lsb-release || true
      if curl -fsSL https://get.docker.com | sh; then
        ok "Docker installed"
      else
        warn "Falling back to docker.io"
        apt-get install -y docker.io || true
      fi
    else
      err "Cannot auto-install Docker (apt-get not available). Please install Docker manually."
      return 1
    fi
  else
    ok "Docker present: $(docker --version | head -n1)"
  fi

  if docker compose version >/dev/null 2>&1; then
    ok "docker compose plugin available"
  elif need_cmd docker-compose; then
    ok "docker-compose available"
  else
    warn "Docker Compose not found. Installing compose plugin (Debian/Ubuntu)..."
    if need_cmd apt-get; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y || true
      apt-get install -y docker-compose-plugin || true
      if ! docker compose version >/dev/null 2>&1; then
        # last resort: standalone binary
        local ver="v2.27.0"; local bin="/usr/local/bin/docker-compose"
        local arch=$(uname -m); local os=$(uname -s)
        log "Installing standalone docker-compose ${ver}"
        curl -fsSL -o "${bin}" "https://github.com/docker/compose/releases/download/${ver}/docker-compose-${os}-${arch}" && chmod +x "${bin}" || true
        need_cmd docker-compose || { err "Compose installation failed"; return 1; }
      fi
    else
      err "Cannot auto-install compose (apt-get not available)."
      return 1
    fi
  fi
}

setup_portainer() {
  log "[+] Setting up Portainer Community Edition"
  need_cmd docker || { err "Docker required for Portainer"; return 1; }
  docker volume create portainer_data >/dev/null 2>&1 || true
  if docker ps -a --format '{{.Names}}' | grep -q '^portainer$'; then
    warn "Portainer container already exists; skipping"
  else
    docker run -d \
      -p 8000:8000 -p 9443:9443 \
      --name portainer --restart=always \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v portainer_data:/data \
      cr.portainer.io/portainer/portainer-ce:latest >/dev/null
    ok "Portainer running at https://<host>:9443"
  fi
}

docker_install() {
  local APP_DIR="$1"; local PORT="$2"
  install_docker_and_compose
  setup_portainer || true

  # Reuse deploy script with parameters
  export APP_DIR PORT EXTERNAL_PORT
  EXTERNAL_PORT="$PORT"
  APP_DIR="$APP_DIR"
  if [[ ! -x ./scripts/deploy_netbox_ops_center_docker.sh ]]; then
    err "deploy_netbox_ops_center_docker.sh not found (run from repo root)"
    return 1
  fi
  ./scripts/deploy_netbox_ops_center_docker.sh
}

install_prereqs_bare() {
  if need_cmd apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y || true
    apt-get install -y git curl jq ca-certificates build-essential || true
  fi
}

install_node_nvm() {
  if need_cmd node && need_cmd npm; then ok "Node.js present: $(node -v)"; return 0; fi
  log "[+] Installing Node.js via nvm (user-level)"
  if ! need_cmd curl; then err "curl required to install nvm/node"; return 1; fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
}

bare_install() {
  local APP_DIR="$1"; local PORT="$2"
  install_prereqs_bare
  install_node_nvm

  mkdir -p "$APP_DIR"
  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "[+] Cloning repository into $APP_DIR"
    git clone https://github.com/keslleykledston/11-Netbox_ops_center.git "$APP_DIR"
  else
    log "[+] Pulling latest changes"
    git -C "$APP_DIR" pull --ff-only || true
  fi

  cd "$APP_DIR"
  log "[+] Preparing env files"
  [[ -f .env ]] || cp .env.example .env || true
  [[ -f .env.local ]] || touch .env.local || true
  # Generate secrets if placeholders present
  if need_cmd openssl; then
    JWT_SECRET=$(openssl rand -hex 24)
    CRED=$(openssl rand -base64 32)
    if ! grep -q '^JWT_SECRET=' .env.local 2>/dev/null; then
      if ! grep -q '^JWT_SECRET=' .env 2>/dev/null || grep -q '^JWT_SECRET=change_me' .env 2>/dev/null; then
        echo "JWT_SECRET=${JWT_SECRET}" >> .env.local
      fi
    fi
    if ! grep -q '^CRED_ENCRYPTION_KEY=' .env.local 2>/dev/null; then
      if ! grep -q '^CRED_ENCRYPTION_KEY=' .env 2>/dev/null || grep -q '^CRED_ENCRYPTION_KEY=change_me' .env 2>/dev/null; then
        echo "CRED_ENCRYPTION_KEY=${CRED}" >> .env.local
      fi
    fi
  fi

  log "[+] Installing dependencies"
  npm install
  npm run server:install
  npm run db:push

  log "[+] Starting the stack (web+api+snmp) in background"
  nohup bash -lc "npm run dev:stack" > /var/log/netbox-ops-center.log 2>&1 &
  ok "Application starting on http://localhost:8080 (change proxy/ports if needed)"
}

main() {
  log "=== NetBox Ops Center Installer ==="
  local mode="${MODE:-}"
  if [[ -z "$mode" ]]; then
    mode=$(prompt "Installation mode? (docker/bare)" "docker")
  fi
  local app_dir="$DEFAULT_APP_DIR"
  local port="$DEFAULT_PORT"
  app_dir=$(prompt "Installation directory" "$app_dir")
  if [[ "$mode" == "docker" ]]; then
    port=$(prompt "External web port (Vite dev UI)" "$port")
    docker_install "$app_dir" "$port"
  else
    bare_install "$app_dir" "$port"
  fi
  ok "Done."
}

main "$@"
