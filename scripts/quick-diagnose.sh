#!/usr/bin/env bash
set -euo pipefail

TITLE="NetBox Ops Center – Quick Diagnose"

log() { printf "%s\n" "$*"; }
info() { printf "[*] %s\n" "$*"; }
ok()   { printf "[OK] %s\n" "$*"; }
warn() { printf "[WARN] %s\n" "$*"; }
err()  { printf "[ERR] %s\n" "$*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || { err "Missing command: $1"; return 1; }; }

load_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$file" || true
    set +a
    ok "Loaded env: $file"
  else
    warn "Env not found: $file"
  fi
}

curl_json() {
  local url="$1"; shift
  curl -fsS -m 5 -H 'Accept: application/json' "$url" "$@" || return $?
}

http_code() {
  local url="$1"; shift
  curl -sS -m 5 -o /dev/null -w '%{http_code}' "$url" "$@" || echo "000"
}

check_node() {
  if ! need_cmd node; then warn "Node.js not installed"; return; fi
  local v; v=$(node -v 2>/dev/null || true)
  info "Node.js version: ${v:-unknown} (require >= 18)"
}

check_npm() {
  if ! need_cmd npm; then warn "npm not installed"; return; fi
  local v; v=$(npm -v 2>/dev/null || true)
  info "npm version: ${v:-unknown}"
}

check_docker() {
  if command -v docker >/dev/null 2>&1; then
    ok "Docker: $(docker --version | head -n1)"
  else
    warn "Docker not found (optional)"
  fi
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose plugin available"
  elif command -v docker-compose >/dev/null 2>&1; then
    ok "docker-compose available"
  else
    warn "Docker Compose not found (optional)"
  fi
}

check_structure() {
  [[ -d server ]] && ok "server/ present" || err "server/ missing"
  [[ -f server/prisma/schema.prisma ]] && ok "Prisma schema present" || warn "Prisma schema missing: server/prisma/schema.prisma"
}

check_api() {
  local port="${PORT:-4000}"
  local code; code=$(http_code "http://localhost:${port}/health")
  if [[ "$code" == "200" ]]; then ok "API healthy at :${port}"; else warn "API /health HTTP ${code} at :${port}"; fi
}

check_web() {
  local wport="${WEB_PORT:-8080}"
  local code; code=$(http_code "http://localhost:${wport}/")
  if [[ "$code" == "200" || "$code" == "304" ]]; then ok "Web responding at :${wport}"; else warn "Web not responding (HTTP ${code}) at :${wport}"; fi
}

check_snmp() {
  local sport="${SNMP_SERVER_PORT:-3001}"
  local ip="${SNMP_TEST_IP:-127.0.0.1}"
  local comm="${SNMP_TEST_COMM:-public}"
  local code; code=$(http_code "http://localhost:${sport}/api/snmp/ping?ip=${ip}&community=${comm}")
  if [[ "$code" == "200" ]]; then ok "SNMP gateway responding at :${sport}"; else warn "SNMP gateway not responding (HTTP ${code}) at :${sport}"; fi
}

test_login() {
  local ident="${ADMIN_USERNAME:-${ADMIN_EMAIL:-}}"
  local pass="${ADMIN_PASSWORD:-}"
  local port="${PORT:-4000}"
  if [[ -z "$ident" || -z "$pass" ]]; then
    warn "ADMIN_USERNAME/ADMIN_EMAIL and ADMIN_PASSWORD not set – skipping login test"
    return 0
  fi
  local token
  token=$(curl_json "http://localhost:${port}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"${ident}\",\"password\":\"${pass}\"}" | awk -F '"' '/token/ {print $4}' || true)
  if [[ -n "$token" ]]; then ok "Login ok for '${ident}'"; else warn "Login failed for '${ident}'"; fi
}

test_tenants() {
  local port="${PORT:-4000}"
  local ident="${ADMIN_USERNAME:-${ADMIN_EMAIL:-}}"
  local pass="${ADMIN_PASSWORD:-}"
  if [[ -z "$ident" || -z "$pass" ]]; then return 0; fi
  local token
  token=$(curl_json "http://localhost:${port}/auth/login" -H 'Content-Type: application/json' -d "{\"identifier\":\"${ident}\",\"password\":\"${pass}\"}" | awk -F '"' '/token/ {print $4}' || true)
  if [[ -z "$token" ]]; then return 0; fi
  local code; code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" "http://localhost:${port}/tenants")
  if [[ "$code" == "200" ]]; then ok "Tenants accessible"; else warn "Tenants HTTP ${code}"; fi
}

test_netbox_catalog() {
  local port="${PORT:-4000}"
  local url="${NETBOX_URL:-}"
  local token_env="${NETBOX_TOKEN:-}"
  if [[ -z "$url" || -z "$token_env" ]]; then warn "NETBOX_URL/TOKEN not set – skipping NetBox catalog test"; return 0; fi
  local ident="${ADMIN_USERNAME:-${ADMIN_EMAIL:-}}"
  local pass="${ADMIN_PASSWORD:-}"
  if [[ -z "$ident" || -z "$pass" ]]; then warn "Admin creds not set – skipping NetBox catalog test"; return 0; fi
  local at; at=$(curl_json "http://localhost:${port}/auth/login" -H 'Content-Type: application/json' -d "{\"identifier\":\"${ident}\",\"password\":\"${pass}\"}" | awk -F '"' '/token/ {print $4}' || true)
  if [[ -z "$at" ]]; then warn "Cannot login – skipping NetBox catalog test"; return 0; fi
  local code; code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${at}" -H 'Content-Type: application/json' \
    -d '{"resources":["device-roles","platforms" ]}' \
    "http://localhost:${port}/netbox/catalog")
  if [[ "$code" == "200" ]]; then ok "NetBox catalog reachable via API"; else warn "NetBox catalog HTTP ${code}"; fi
}

main() {
  log "${TITLE}"
  echo "----------------------------------------------"
  check_node
  check_npm
  check_docker
  check_structure

  # Load envs (root + local overrides)
  load_env ".env"
  load_env ".env.local"

  # Show relevant envs
  info "VITE_API_URL=${VITE_API_URL:-/api}"
  info "API_SERVER_URL=${API_SERVER_URL:-http://localhost:4000}"
  info "SNMP_SERVER_URL=${SNMP_SERVER_URL:-http://localhost:3001}"
  info "NETBOX_TENANT_GROUP_FILTER=${NETBOX_TENANT_GROUP_FILTER:-(not set)}"
  info "PORT=${PORT:-4000} DATABASE_URL=${DATABASE_URL:-postgresql://netbox_ops:netbox_ops@db:5432/netbox_ops}"

  check_web
  check_api
  check_snmp
  test_login
  test_tenants
  test_netbox_catalog

  echo "----------------------------------------------"
  ok "Done"
}

main "$@"
