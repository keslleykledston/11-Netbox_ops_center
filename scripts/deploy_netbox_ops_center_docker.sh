#!/usr/bin/env bash
# NetBox Ops Center - one-shot Docker deploy helper
# Clones the repo, prepares .env files, generates a docker compose, and runs the stack

set -euo pipefail

REPO_URL="https://github.com/keslleykledston/netbox-ops-center"
APP_DIR="${APP_DIR:-$(pwd)/netbox-ops-center}"
EXTERNAL_PORT="${EXTERNAL_PORT:-58080}"

echo "[+] Target dir: ${APP_DIR}"
echo "[+] External web port: ${EXTERNAL_PORT}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "[-] Missing dependency: $1"; exit 1; }
}

detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo ""
  fi
}

need_cmd git
need_cmd docker
COMPOSE_CMD=$(detect_compose)
if [[ -z "${COMPOSE_CMD}" ]]; then
  echo "[-] Docker Compose v2 or docker-compose not found. Please install Docker Desktop (or docker compose plugin)."
  exit 1
fi

mkdir -p "${APP_DIR}"
if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "[+] Cloning repository..."
  git clone --depth 1 "${REPO_URL}" "${APP_DIR}"
else
  echo "[+] Repository already exists. Pulling latest changes..."
  git -C "${APP_DIR}" pull --ff-only
fi

cat >"${APP_DIR}/.env" <<'ENVEOF'
VITE_USE_BACKEND=true
VITE_API_URL=/api

# Proxy targets used by Vite inside container
API_SERVER_URL=http://localhost:4000
SNMP_SERVER_URL=http://localhost:3001

# SNMP gateway defaults
SNMP_SERVER_PORT=3001
SNMP_MAX_REPETITIONS=20
SNMP_GLOBAL_TIMEOUT_MS=60000

# NetBox (optional)
# NETBOX_URL=
# NETBOX_TOKEN=
NETBOX_TENANT_GROUP_FILTER=K3G Solutions

# Jumpserver (optional)
# JUMPSERVER_URL=
# JUMPSERVER_TOKEN=
ENVEOF

mkdir -p "${APP_DIR}/server"
cat >"${APP_DIR}/server/.env" <<'SENVEOF'
DATABASE_URL="file:./dev.db"
PORT=4000
JWT_SECRET=change_me

# Optional NetBox integration
# NETBOX_URL=
# NETBOX_TOKEN=

# Encryption key for device credentials (any strong random string)
CRED_ENCRYPTION_KEY=please_change_this_key
SENVEOF

cat >"${APP_DIR}/docker-compose.yml" <<YAMLEOF
name: netbox-ops-center
services:
  app:
    image: node:20-alpine
    working_dir: /app
    environment:
      - NODE_ENV=development
    volumes:
      - ./:/app
    ports:
      - "${EXTERNAL_PORT}:8080"   # web (Vite dev)
      # API/SNMP stay internal to container via Vite proxy
      # - "4000:4000"              # (optional) expose API
      # - "3001:3001"              # (optional) expose SNMP gateway
    command: sh -lc "npm ci && npm run db:push && npm run dev:all"
    restart: unless-stopped
YAMLEOF

echo "[+] Installing dependencies (first run will take longer)..."
${COMPOSE_CMD} -f "${APP_DIR}/docker-compose.yml" up -d --remove-orphans

echo "[+] Waiting a few seconds for the dev servers to start..."
sleep 5 || true

echo
echo "[OK] NetBox Ops Center is starting. Access the web UI:"
echo "     http://localhost:${EXTERNAL_PORT}/"
echo
echo "Useful commands:"
echo "  - Stop:   ${COMPOSE_CMD} -f ${APP_DIR}/docker-compose.yml down"
echo "  - Logs:   ${COMPOSE_CMD} -f ${APP_DIR}/docker-compose.yml logs -f"
echo "  - Rebuild:${COMPOSE_CMD} -f ${APP_DIR}/docker-compose.yml up -d --build"

