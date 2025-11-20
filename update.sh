#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Checking for updates...${NC}"

# Ensure we are in the project directory
cd "$(dirname "$0")"

# Fetch latest changes from remote
git fetch origin main

# Check if local is behind remote
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "${GREEN}System is already up to date.${NC}"
    echo "Current version: $LOCAL"
    exit 0
else
    echo -e "${YELLOW}Update available!${NC}"
    echo "Local version: $LOCAL"
    echo "Remote version: $REMOTE"
    
    echo -e "${YELLOW}Starting update process...${NC}"
    
    # Pull changes
    echo "1. Pulling latest code..."
    if git pull origin main; then
        echo -e "${GREEN}Code updated successfully.${NC}"
    else
        echo -e "${RED}Failed to pull code. Please check git status manually.${NC}"
        exit 1
    fi
    
    # Update version file
    echo "2. Updating version info..."
    echo "Version: $REMOTE" > VERSION
    echo "Date: $(date)" >> VERSION
    
    # Update containers
    echo "3. Updating containers..."
    
    # Pull latest images for external services (nginx, portainer, oxidized)
    echo "   - Pulling latest images..."
    docker compose pull
    
    # Rebuild app container if needed and restart services
    # 'up -d --build' will recreate containers only if config or image changed
    echo "   - Restarting services..."
    if docker compose up -d --build; then
        echo -e "${GREEN}Containers updated and restarted successfully.${NC}"
    else
        echo -e "${RED}Failed to update containers.${NC}"
        exit 1
    fi
    
    # Prune old images to save space
    echo "4. Cleaning up..."
    docker image prune -f
    
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}   Update Completed Successfully! 🚀     ${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo "New version: $REMOTE"
fi
