#!/usr/bin/env bash
# NetBox Ops Center - Interactive Installer
# Installs Docker, Portainer, Oxidized, and the Web App with Nginx Reverse Proxy.

set -euo pipefail

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

OS_ID=""
OS_LIKE=""
PKG_MANAGER=""
UPDATE_CMD=""
INSTALL_CMD=""

ensure_root() {
    if [[ $EUID -ne 0 ]]; then
        if command -v sudo >/dev/null 2>&1; then
            log "Re-executing with sudo..."
            exec sudo -E bash "$0" "$@"
        else
            error "This script must be run as root (sudo not available)."
        fi
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_LIKE="${ID_LIKE:-}"
    else
        OS_ID="$(uname -s | tr '[:upper:]' '[:lower:]')"
        OS_LIKE=""
    fi

    if [[ "$OS_ID" == "darwin" || "$OS_ID" == "macos" ]]; then
        error "macOS is not supported by this installer. Use Docker Desktop manually."
    fi

    log "Detected OS: ${OS_ID} ${OS_LIKE}"
}

detect_package_manager() {
    if command -v apt-get >/dev/null 2>&1; then
        PKG_MANAGER="apt"
        UPDATE_CMD="apt-get update -y"
        INSTALL_CMD="apt-get install -y"
    elif command -v dnf >/dev/null 2>&1; then
        PKG_MANAGER="dnf"
        UPDATE_CMD="dnf -y makecache"
        INSTALL_CMD="dnf -y install"
    elif command -v yum >/dev/null 2>&1; then
        PKG_MANAGER="yum"
        UPDATE_CMD="yum -y makecache"
        INSTALL_CMD="yum -y install"
    elif command -v zypper >/dev/null 2>&1; then
        PKG_MANAGER="zypper"
        UPDATE_CMD="zypper refresh -y"
        INSTALL_CMD="zypper install -y"
    elif command -v pacman >/dev/null 2>&1; then
        PKG_MANAGER="pacman"
        UPDATE_CMD="pacman -Sy --noconfirm"
        INSTALL_CMD="pacman -S --noconfirm"
    else
        error "No supported package manager found."
    fi
}

install_packages() {
    local packages=("$@")
    if [[ -z "$PKG_MANAGER" ]]; then
        detect_package_manager
    fi
    log "Installing packages (${PKG_MANAGER}): ${packages[*]}"
    $UPDATE_CMD >/dev/null 2>&1 || warn "Failed to update package index."
    $INSTALL_CMD "${packages[@]}" >/dev/null 2>&1 || error "Failed to install packages: ${packages[*]}"
}

install_prereqs() {
    log "Installing OS prerequisites..."
    case "$PKG_MANAGER" in
        apt)
            install_packages ca-certificates curl gnupg lsb-release git jq openssl
            ;;
        dnf|yum)
            install_packages ca-certificates curl gnupg2 git jq openssl
            ;;
        zypper)
            install_packages ca-certificates curl gpg2 git jq openssl
            ;;
        pacman)
            install_packages ca-certificates curl gnupg git jq openssl
            ;;
        *)
            warn "Unknown package manager. Skipping prerequisite install."
            ;;
    esac
}

run_compose() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        error "Docker Compose not found."
    fi
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
        if ! command -v curl >/dev/null 2>&1; then
            install_packages curl
        fi
        if curl -fsSL https://get.docker.com | sh; then
            success "Docker installed successfully."
        else
            warn "get.docker.com failed. Trying distro packages..."
            case "$PKG_MANAGER" in
                apt) install_packages docker.io ;;
                dnf|yum) install_packages docker ;;
                zypper) install_packages docker ;;
                pacman) install_packages docker ;;
                *) error "Docker install failed on this distro." ;;
            esac
        fi
    fi

    if command -v systemctl >/dev/null 2>&1; then
        systemctl enable --now docker >/dev/null 2>&1 || warn "Failed to enable/start Docker."
    fi

    if docker compose version >/dev/null 2>&1; then
        success "Docker Compose is available."
    elif command -v docker-compose >/dev/null 2>&1; then
        success "docker-compose is available."
    else
        log "Installing Docker Compose..."
        case "$PKG_MANAGER" in
            apt) install_packages docker-compose-plugin ;;
            dnf|yum) install_packages docker-compose-plugin ;;
            zypper) install_packages docker-compose ;;
            pacman) install_packages docker-compose ;;
            *) error "Failed to install Docker Compose on this distro." ;;
        esac
        if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
            error "Docker Compose not available after install."
        fi
    fi
}

configure_docker() {
    log "Configuring Docker for Legacy API support..."
    local daemon_json="/etc/docker/daemon.json"
    mkdir -p /etc/docker
    
    if [ -f "$daemon_json" ]; then
        warn "$daemon_json already exists. Please manually ensure 'min-api-version': '1.24' is set."
    else
        log "Creating $daemon_json..."
        cat > "$daemon_json" <<EOF
{
  "min-api-version": "1.24",
  "max-concurrent-uploads": 16,
  "max-concurrent-downloads": 16
}
EOF
        success "Docker configured."
        
        log "Restarting Docker..."
        if command -v systemctl >/dev/null 2>&1; then
            systemctl restart docker || warn "Failed to restart Docker. Please restart manually."
        else
            warn "systemctl not found. Please restart Docker manually."
        fi
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
    
    # Create .env.local with secrets if needed
    if [ ! -f .env.local ]; then
        if command -v openssl >/dev/null 2>&1; then
            JWT_SECRET=$(openssl rand -hex 32)
            CRED_ENCRYPTION_KEY=$(openssl rand -base64 32)
            cat > .env.local <<EOF
JWT_SECRET=${JWT_SECRET}
CRED_ENCRYPTION_KEY=${CRED_ENCRYPTION_KEY}
EOF
            success "Created .env.local with generated secrets."
        else
            warn "openssl not found. Create .env.local and set JWT_SECRET/CRED_ENCRYPTION_KEY manually."
            touch .env.local
        fi
    fi

    # Ensure default admin credentials for new installations
    if [ ! -f .env.local ]; then
        touch .env.local
    fi
    if ! grep -q '^DEFAULT_ADMIN_EMAIL=' .env.local 2>/dev/null; then
        echo "DEFAULT_ADMIN_EMAIL=suporte@suporte.com.br" >> .env.local
    fi
    if ! grep -q '^DEFAULT_ADMIN_USERNAME=' .env.local 2>/dev/null; then
        echo "DEFAULT_ADMIN_USERNAME=admin" >> .env.local
    fi
    if ! grep -q '^DEFAULT_ADMIN_PASSWORD=' .env.local 2>/dev/null; then
        echo "DEFAULT_ADMIN_PASSWORD=Ops_pass_" >> .env.local
    fi
}

install_dependencies() {
    if ! command -v npm >/dev/null 2>&1; then
        warn "npm nao encontrado. Instalando Node.js..."
        case "$PKG_MANAGER" in
            apt) install_packages nodejs npm ;;
            dnf|yum) install_packages nodejs npm ;;
            zypper) install_packages nodejs npm ;;
            pacman) install_packages nodejs npm ;;
            *) warn "Nao foi possivel instalar Node.js automaticamente." ;;
        esac
    fi

    if ! command -v npm >/dev/null 2>&1; then
        warn "npm nao encontrado no PATH. Pulando instalacao das dependencias Node."
        return
    fi

    if [ -f package.json ]; then
        log "Instalando dependências do frontend..."
        npm install >/dev/null 2>&1 || error "Falha ao executar 'npm install' na raiz do projeto."
    else
        warn "package.json não encontrado na raiz. Pulando instalação do frontend."
    fi

    if [ -d server ] && [ -f server/package.json ]; then
        log "Instalando dependências do backend..."
        npm --prefix server install >/dev/null 2>&1 || error "Falha ao executar 'npm --prefix server install'."
        log "Gerando Prisma Client..."
        npm --prefix server run prisma:generate >/dev/null 2>&1 || warn "Não foi possível gerar o Prisma Client. Execute 'npm --prefix server run prisma:generate' manualmente."
    else
        warn "Diretório 'server' não encontrado. Pulando instalação do backend."
    fi
}

initialize_oxidized() {
    log "Initializing Oxidized configuration..."

    if [ -x "./scripts/init-oxidized.sh" ]; then
        ./scripts/init-oxidized.sh
        if [ $? -eq 0 ]; then
            success "Oxidized initialized successfully."
        else
            warn "Failed to initialize Oxidized. You may need to run scripts/init-oxidized.sh manually."
        fi
    else
        warn "Oxidized initialization script not found or not executable."
        log "You may need to manually configure Oxidized later."
    fi
}

start_services() {
    log "Starting services with Docker Compose..."
    log "  - Pulling latest images..."
    run_compose pull

    log "  - Starting containers..."
    run_compose up -d --remove-orphans

    if [ $? -eq 0 ]; then
        success "Services started successfully."
    else
        error "Failed to start services."
    fi
}

run_migrations() {
    log "Applying database migrations..."
    if ! wait_for_db; then
        warn "Postgres not ready. Skipping migrations for now."
        return
    fi
    local attempt=1
    local max_attempts=5
    while [ $attempt -le $max_attempts ]; do
        if run_compose exec -T backend npm --prefix server run db:migrate; then
            success "Migrations applied."
            return 0
        fi
        warn "Migration attempt ${attempt}/${max_attempts} failed. Retrying..."
        attempt=$((attempt + 1))
        sleep 3
    done
    warn "Failed to apply migrations automatically. Run 'npm --prefix server run db:migrate' inside the backend container."
}

run_prisma_generate() {
    log "Generating Prisma client binaries..."
    if run_compose exec -T backend npm --prefix server run prisma:generate; then
        success "Prisma client generated."
    else
        warn "Failed to generate Prisma client. Run 'npm --prefix server run prisma:generate' inside the backend container."
    fi
}

wait_for_db() {
    log "Waiting for Postgres to be ready..."
    local attempt=1
    local max_attempts=20
    while [ $attempt -le $max_attempts ]; do
        if run_compose exec -T db pg_isready -U netbox_ops -d netbox_ops >/dev/null 2>&1; then
            success "Postgres is ready."
            return 0
        fi
        warn "Postgres not ready (${attempt}/${max_attempts}). Retrying in 3s..."
        attempt=$((attempt + 1))
        sleep 3
    done
    return 1
}

verify_installation() {
    log "Verifying installation..."
    sleep 5
    
    if run_compose ps | grep -q "Up"; then
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
    
    ensure_root "$@"
    detect_os
    detect_package_manager
    install_prereqs
    
    log "Starting installation..."

    # 1. Docker Check/Install
    log "Step 1/6: Checking Docker installation..."
    install_docker
    configure_docker
    progress_bar 2

    # 2. Environment Setup
    log "Step 2/6: Setting up environment..."
    setup_environment
    progress_bar 1

    # 3. Dependencies
    log "Step 3/6: Installing Node dependencies..."
    install_dependencies
    progress_bar 1

    # 4. Initialize Oxidized
    log "Step 4/6: Initializing Oxidized..."
    initialize_oxidized
    progress_bar 1

    # 5. Start Services
    log "Step 5/6: Starting services..."
    start_services
    progress_bar 5

    # 6. Verify
    log "Step 6/6: Applying migrations and verifying installation..."
    run_migrations
    run_prisma_generate
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
    echo "Next steps:"
    echo " 1. Access the dashboard and login with default credentials:"
    echo "    - Email: suporte@suporte.com.br"
    echo "    - Username: admin"
    echo "    - Senha: Ops_pass_"
    echo " 2. Configure Oxidized in the Applications tab"
    echo "    - Add application: Name='Oxidized', URL='http://oxidized:8888'"
    echo " 3. Enable backup for devices in the Backup tab"
    echo ""
    echo "Documentation:"
    echo " - Installation logs: $LOG_FILE"
    echo " - Oxidized setup: OXIDIZED_SETUP.md"
    echo " - General usage: README.md"
    echo ""
    success "All services are running!"
}

main
