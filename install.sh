#!/usr/bin/env bash
# NetBox Ops Center - Interactive Installer
# Installs Docker, Portainer, Oxidized, and the Web App with Nginx Reverse Proxy.

set -u

LOG_FILE="install_log.txt"
exec > >(tee -a "$LOG_FILE") 2>&1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Progress Bar
progress_bar() {
    local duration=${1}
    local block="▓"
    local empty="░"
    local width=50
    local progress=0
    local step=$((width * 100 / duration / 10)) # approx

    echo -ne "["
    for ((i=0; i<width; i++)); do echo -ne "$empty"; done
    echo -ne "] 0%"
    
    for ((i=0; i<=100; i+=5)); do
        local num_blocks=$((i * width / 100))
        echo -ne "\r["
        for ((j=0; j<num_blocks; j++)); do echo -ne "$block"; done
        for ((j=num_blocks; j<width; j++)); do echo -ne "$empty"; done
        echo -ne "] $i%"
        sleep $((duration / 20))
    done
    echo ""
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
       error "This script must be run as root"
    fi
}

install_docker() {
    if command -v docker >/dev/null 2>&1; then
        success "Docker is already installed."
    else
        log "Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        success "Docker installed successfully."
    fi

    if command -v docker compose >/dev/null 2>&1; then
        success "Docker Compose is available."
    else
        log "Installing Docker Compose..."
        apt-get update && apt-get install -y docker-compose-plugin || error "Failed to install Docker Compose plugin"
        success "Docker Compose installed."
    fi
}

setup_environment() {
    log "Setting up environment..."
    
    # Create necessary directories
    mkdir -p docker/nginx
    
    # Check for .env
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            success "Created .env from example."
        else
            warn ".env.example not found. Creating basic .env"
            touch .env
        fi
    fi
    
    # Check for server/.env
    if [ ! -d server ]; then
        mkdir -p server
    fi
    if [ ! -f server/.env ]; then
        if [ -f server/.env.example ]; then
            cp server/.env.example server/.env
            success "Created server/.env from example."
        else
             cat > server/.env <<EOF
DATABASE_URL="file:./dev.db"
PORT=4000
JWT_SECRET=$(openssl rand -hex 32)
EOF
            success "Created server/.env with generated secret."
        fi
    fi
}

start_services() {
    log "Starting services with Docker Compose..."
    docker compose up -d --remove-orphans
    
    if [ $? -eq 0 ]; then
        success "Services started successfully."
    else
        error "Failed to start services."
    fi
}

verify_installation() {
    log "Verifying installation..."
    sleep 5
    
    if docker compose ps | grep "Up"; then
        success "Containers are running."
    else
        warn "Some containers might not be running. Check 'docker compose ps'."
    fi
}

main() {
    clear
    echo "=================================================="
    echo "   NetBox Ops Center - Installation Wizard"
    echo "=================================================="
    echo ""
    
    # check_root # Commented out for development/testing in non-root env if needed, but required for docker install
    
    log "Starting installation..."
    
    # 1. Docker Check/Install
    install_docker
    progress_bar 2
    
    # 2. Environment Setup
    setup_environment
    progress_bar 1
    
    # 3. Start Services
    start_services
    progress_bar 5
    
    # 4. Verify
    verify_installation
    
    echo ""
    echo "=================================================="
    echo "   Installation Complete!"
    echo "=================================================="
    echo "Access your services at:"
    echo " - Dashboard: http://localhost/"
    echo " - Portainer: http://localhost/portainer/"
    echo " - Oxidized:  http://localhost/oxidized/"
    echo ""
    echo "Logs available in $LOG_FILE"
}

main
