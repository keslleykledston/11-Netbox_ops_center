#!/bin/bash

# Configuration
LOG_FILE="update.log"
VERSION_FILE="VERSION"
LOCK_FILE=".update.lock"
DOCKER_COMPOSE_CMD=""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper function for logging
log() {
    local msg="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "$msg"
    echo "[$timestamp] $msg" | sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE"
}

log "${YELLOW}Checking for updates...${NC}"

# Ensure we are in the project directory
cd "$(dirname "$0")"

# Prevent concurrent updates
if [ -f "$LOCK_FILE" ]; then
    log "${YELLOW}Update already running. Remove $LOCK_FILE if this is stale.${NC}"
    exit 1
fi
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# Check dependencies
for cmd in git docker; do
    if ! command -v $cmd &> /dev/null; then
        log "${RED}Error: $cmd is not installed.${NC}"
        exit 1
    fi
done

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    log "${RED}Error: docker compose not available.${NC}"
    exit 1
fi

# Fetch latest changes from remote
git fetch origin main

# Check if local is behind remote
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "${GREEN}System is already up to date.${NC}"
    log "Current version: $LOCAL"
    exit 0
else
    log "${YELLOW}Update available!${NC}"
    log "Local version: $LOCAL"
    log "Remote version: $REMOTE"
    
    log "${YELLOW}Starting update process...${NC}"
    
    # 0. Backup Database
    log "0. Creating database backup..."
    BACKUP_DIR="backups"
    mkdir -p "$BACKUP_DIR"

    # Load envs if present (root + local overrides)
    set -a
    for env_file in .env .env.local; do
        if [ -f "$env_file" ]; then
            # shellcheck disable=SC1091
            . "$env_file"
        fi
    done
    set +a

    DB_URL="${DATABASE_URL:-}"
    if [[ "$DB_URL" == postgresql* ]]; then
        if command -v pg_dump >/dev/null 2>&1; then
            BACKUP_NAME="pg_backup_$(date '+%Y%m%d_%H%M%S').sql"
            if PGCONNECT_TIMEOUT=5 pg_dump "$DB_URL" > "$BACKUP_DIR/$BACKUP_NAME" 2>/dev/null; then
                log "${GREEN}PostgreSQL backup created at $BACKUP_DIR/$BACKUP_NAME${NC}"
            else
                log "${YELLOW}Warning: pg_dump failed. Skipping DB backup.${NC}"
            fi
        else
            log "${YELLOW}pg_dump not found; skipping PostgreSQL backup.${NC}"
        fi
    else
        DB_FILE="server/dev.db"
        if [ -f "$DB_FILE" ]; then
            BACKUP_NAME="dev_backup_$(date '+%Y%m%d_%H%M%S').db"
            cp "$DB_FILE" "$BACKUP_DIR/$BACKUP_NAME"
            log "${GREEN}SQLite backup to $BACKUP_DIR/$BACKUP_NAME${NC}"
            # Keep only last 5 backups
            ls -t "$BACKUP_DIR"/*.db | tail -n +6 | xargs -I {} rm -- {} 2>/dev/null
        else
            log "${YELLOW}Warning: Database not found for backup.${NC}"
        fi
    fi
    
    # Pull changes
    log "1. Pulling latest code..."
    if git pull origin main; then
        log "${GREEN}Code updated successfully.${NC}"
    else
        log "${RED}Failed to pull code. Please check git status manually.${NC}"
        exit 1
    fi
    
    # Update version file
    log "2. Updating version info..."
    echo "Version: $REMOTE" > "$VERSION_FILE"
    echo "Date: $(date)" >> "$VERSION_FILE"
    
    # Update containers
    log "3. Updating containers..."
    
    # Pull latest images for external services (nginx, portainer, oxidized)
    log "   - Pulling latest images..."
    $DOCKER_COMPOSE_CMD pull
    
    # Rebuild app container if needed and restart services
    # 'up -d --build' will recreate containers only if config or image changed
    log "   - Restarting services..."
    if $DOCKER_COMPOSE_CMD up -d --build; then
        log "${GREEN}Containers updated and restarted successfully.${NC}"
    else
        log "${RED}Failed to update containers.${NC}"
        exit 1
    fi
    
    # Prune old images to save space
    log "4. Cleaning up..."
    docker image prune -f
    
    log "${GREEN}=========================================${NC}"
    log "${GREEN}   Update Completed Successfully! 🚀     ${NC}"
    log "${GREEN}=========================================${NC}"
    log "New version: $REMOTE"
fi
