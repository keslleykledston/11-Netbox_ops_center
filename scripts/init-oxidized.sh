#!/bin/bash

##############################################################################
# Oxidized Initialization Script
#
# This script initializes the Oxidized volume with the correct configuration
# files and directory structure. It should be run during initial deployment
# or when resetting the Oxidized configuration.
#
# Usage: ./scripts/init-oxidized.sh
##############################################################################

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
VOLUME_NAME="11-netbox_ops_center_oxidized_config"

# Helper function for logging
log() {
    local level="$1"
    shift
    local msg="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case "$level" in
        INFO)
            echo -e "${GREEN}[INFO]${NC} [$timestamp] $msg"
            ;;
        WARN)
            echo -e "${YELLOW}[WARN]${NC} [$timestamp] $msg"
            ;;
        ERROR)
            echo -e "${RED}[ERROR]${NC} [$timestamp] $msg"
            ;;
        *)
            echo "[$timestamp] $msg"
            ;;
    esac
}

log INFO "Starting Oxidized initialization..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    log ERROR "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if volume exists
if ! docker volume ls | grep -q "$VOLUME_NAME"; then
    log WARN "Volume $VOLUME_NAME does not exist. It will be created by docker-compose."
fi

log INFO "Creating Oxidized configuration file..."

# Create configuration file
docker run --rm -v "$VOLUME_NAME:/data" alpine sh -c 'cat > /data/config << "EOF"
---
username: username
password: password
model: ios
resolve_dns: false
interval: 3600
debug: false
run_once: false
use_syslog: false
threads: 30
use_max_threads: false
timeout: 20
timelimit: 300
retries: 3
prompt: !ruby/regexp /^([\w.@-]+[#>]\s?)$/
next_adds_job: true
vars: {}
groups: {}
group_map: {}
models: {}
pid: "/home/oxidized/.config/oxidized/pid"
crash:
  directory: "/home/oxidized/.config/oxidized/crashes"
  hostnames: false
stats:
  history_size: 10
input:
  default: ssh, telnet
  debug: false
  ssh:
    secure: false
  ftp:
    passive: true
  utf8_encoded: true
output:
  default: file
  file:
    directory: "/home/oxidized/.config/oxidized/configs"
rest: 0.0.0.0:8888
source:
  default: csv
  csv:
    file: "/home/oxidized/.config/oxidized/router.db"
    delimiter: !ruby/regexp /:/
    map:
      name: 0
      model: 1
      username: 2
      password: 3
    gpg: false
model_map:
  juniper: junos
  cisco: ios
  mikrotik: routeros
EOF
'

if [ $? -eq 0 ]; then
    log INFO "Configuration file created successfully"
else
    log ERROR "Failed to create configuration file"
    exit 1
fi

log INFO "Creating directory structure..."

# Create required directories
docker run --rm -v "$VOLUME_NAME:/data" alpine sh -c '
mkdir -p /data/crashes /data/configs
chmod -R 755 /data
'

if [ $? -eq 0 ]; then
    log INFO "Directory structure created successfully"
else
    log ERROR "Failed to create directory structure"
    exit 1
fi

log INFO "Creating router.db with placeholder..."

# Create router.db with placeholder
docker run --rm -v "$VOLUME_NAME:/data" alpine sh -c 'cat > /data/router.db << "EOF"
# Format: hostname:model:username:password
# Placeholder - will be replaced when devices are enabled for backup
placeholder.local:ios:admin:password
EOF
'

if [ $? -eq 0 ]; then
    log INFO "router.db created successfully"
else
    log ERROR "Failed to create router.db"
    exit 1
fi

log INFO "Verifying configuration..."

# Verify files were created
docker run --rm -v "$VOLUME_NAME:/data" alpine ls -lah /data/

log INFO "${GREEN}=========================================${NC}"
log INFO "${GREEN}Oxidized initialization completed!${NC}"
log INFO "${GREEN}=========================================${NC}"
log INFO "Next steps:"
log INFO "1. Start the Oxidized container: docker compose up -d oxidized"
log INFO "2. Verify it's running: docker logs netbox-ops-center-oxidized"
log INFO "3. Test the API: curl http://localhost:8888/nodes.json"

exit 0
