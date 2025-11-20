#!/bin/bash

# Configuration
LOG_FILE="update.log"
VERSION_FILE="VERSION"

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

# Check dependencies
for cmd in git docker; do
    if ! command -v $cmd &> /dev/null; then
        log "${RED}Error: $cmd is not installed.${NC}"
        exit 1
    fi
done

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
    DB_FILE="server/dev.db"
    BACKUP_DIR="backups"
    
    if [ -f "$DB_FILE" ]; then
        mkdir -p "$BACKUP_DIR"
        BACKUP_NAME="dev_backup_$(date '+%Y%m%d_%H%M%S').db"
        cp "$DB_FILE" "$BACKUP_DIR/$BACKUP_NAME"
        log "${GREEN}Database backed up to $BACKUP_DIR/$BACKUP_NAME${NC}"
        
        # Keep only last 5 backups
        ls -t "$BACKUP_DIR"/*.db | tail -n +6 | xargs -I {} rm -- {} 2>/dev/null
    else
        log "${YELLOW}Warning: Database file $DB_FILE not found. Skipping backup.${NC}"
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
    docker compose pull
    
    # Rebuild app container if needed and restart services
    # 'up -d --build' will recreate containers only if config or image changed
    log "   - Restarting services..."
    if docker compose up -d --build; then
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
