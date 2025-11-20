#!/usr/bin/env bash
# Deploy Netbox Ops Center to Remote Server
# Usage: ./deploy_remote.sh [TARGET_IP] [USER] [PASSWORD]

set -u

# Default Values (from user request)
TARGET_IP="${1:-10.211.55.37}"
USER="${2:-suporte}"
PASS="${3:-suportekggg}"
TARGET_DIR="/home/$USER/netbox_ops_center"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check for sshpass
if ! command -v sshpass >/dev/null 2>&1; then
    log "sshpass not found. Installing (brew/apt)..."
    if command -v brew >/dev/null 2>&1; then
        brew install sshpass
    elif command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y sshpass
    else
        echo "Please install sshpass manually or enter password when prompted."
    fi
fi

SSHPASS_CMD=""
if command -v sshpass >/dev/null 2>&1; then
    SSHPASS_CMD="sshpass -p $PASS"
fi

log "Deploying to $USER@$TARGET_IP:$TARGET_DIR"

# 1. Create Remote Directory
log "Creating remote directory..."
$SSHPASS_CMD ssh -o StrictHostKeyChecking=no "$USER@$TARGET_IP" "mkdir -p $TARGET_DIR" || error "Failed to create remote directory"

# 2. Transfer Files
log "Transferring files..."
# Exclude node_modules, .git, etc. to save time
$SSHPASS_CMD scp -o StrictHostKeyChecking=no -r \
    docker \
    scripts \
    server \
    src \
    docker-compose.yml \
    install.sh \
    package.json \
    tsconfig.json \
    vite.config.ts \
    .env.example \
    "$USER@$TARGET_IP:$TARGET_DIR/" || error "File transfer failed"

# 3. Execute Installer Remotely
log "Running installer on remote server..."
# We use -t to force TTY allocation for the interactive script
$SSHPASS_CMD ssh -t -o StrictHostKeyChecking=no "$USER@$TARGET_IP" "cd $TARGET_DIR && chmod +x install.sh && sudo ./install.sh"

success "Deployment finished!"
