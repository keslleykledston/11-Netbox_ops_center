#!/bin/bash

# Script para monitorar filas do NetBox Ops Center
# Uso: ./scripts/monitor-queues.sh [command]

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API endpoint
API_URL="${API_URL:-http://localhost/api}"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Install with: apt-get install jq (Debian/Ubuntu) or brew install jq (macOS)"
    exit 1
fi

# Function to get auth token (if exists)
get_token() {
    if [ -f ~/.netbox-ops-token ]; then
        cat ~/.netbox-ops-token
    else
        echo ""
    fi
}

TOKEN=$(get_token)

# Function to show overview
show_overview() {
    echo -e "${BLUE}=== Queue Overview ===${NC}\n"

    if [ -z "$TOKEN" ]; then
        echo -e "${YELLOW}No auth token found. Trying without authentication...${NC}"
        RESULT=$(curl -s "$API_URL/queues/overview" 2>/dev/null || echo '{"error":"failed"}')
    else
        RESULT=$(curl -s "$API_URL/queues/overview" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"error":"failed"}')
    fi

    if echo "$RESULT" | jq -e '.queues' > /dev/null 2>&1; then
        echo "$RESULT" | jq -r '.queues[] |
            "\(.name | .[0:20]) \t W:\(.waiting) \t A:\(.active) \t C:\(.completed) \t F:\(.failed) \t D:\(.delayed)"' |
            column -t -s $'\t'
    else
        echo -e "${RED}Failed to fetch queue overview. Check API endpoint and authentication.${NC}"
        echo "Result: $RESULT"
    fi
}

# Function to show jobs for a specific queue
show_queue_jobs() {
    QUEUE_NAME=$1
    STATUS=${2:-active}

    echo -e "${BLUE}=== Jobs in queue: $QUEUE_NAME (status: $STATUS) ===${NC}\n"

    if [ -z "$TOKEN" ]; then
        RESULT=$(curl -s "$API_URL/queues/$QUEUE_NAME/jobs?status=$STATUS&start=0&end=10" 2>/dev/null || echo '[]')
    else
        RESULT=$(curl -s "$API_URL/queues/$QUEUE_NAME/jobs?status=$STATUS&start=0&end=10" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '[]')
    fi

    if echo "$RESULT" | jq -e '.[0]' > /dev/null 2>&1; then
        echo "$RESULT" | jq -r '.[] |
            "ID: \(.id)\nDevice: \(.data.device.name // "N/A")\nAction: \(.data.action // "N/A")\nProgress: \(.progress)%\nState: \(.state)\n"'
    else
        echo -e "${YELLOW}No jobs found.${NC}"
    fi
}

# Function to show LibreNMS sync logs
show_librenms_logs() {
    echo -e "${BLUE}=== LibreNMS Sync Logs (Worker) ===${NC}\n"
    docker logs netbox-ops-center-worker --tail 50 | grep -i librenms --color=always || echo "No LibreNMS logs found"
}

# Function to show backend logs
show_backend_logs() {
    echo -e "${BLUE}=== Backend LibreNMS Logs ===${NC}\n"
    docker logs netbox-ops-center-backend --tail 50 | grep -i librenms --color=always || echo "No LibreNMS logs found"
}

# Function to show scheduler logs
show_scheduler_logs() {
    echo -e "${BLUE}=== Scheduler LibreNMS Logs ===${NC}\n"
    docker logs netbox-ops-center-scheduler --tail 50 | grep -i librenms --color=always || echo "No LibreNMS logs found"
}

# Function to watch queue in real-time
watch_queue() {
    QUEUE_NAME=$1
    echo -e "${BLUE}=== Watching queue: $QUEUE_NAME (press Ctrl+C to stop) ===${NC}\n"

    while true; do
        clear
        show_queue_jobs "$QUEUE_NAME" "active"
        echo ""
        show_queue_jobs "$QUEUE_NAME" "waiting"
        sleep 2
    done
}

# Function to check device LibreNMS status
check_device() {
    DEVICE_NAME=$1

    echo -e "${BLUE}=== Checking device: $DEVICE_NAME ===${NC}\n"

    if [ -z "$TOKEN" ]; then
        echo -e "${RED}Auth token required. Save it to ~/.netbox-ops-token${NC}"
        exit 1
    fi

    # Get device info
    DEVICE=$(curl -s "$API_URL/devices" -H "Authorization: Bearer $TOKEN" | \
        jq -r ".[] | select(.name | contains(\"$DEVICE_NAME\"))")

    if [ -z "$DEVICE" ]; then
        echo -e "${RED}Device not found: $DEVICE_NAME${NC}"
        exit 1
    fi

    DEVICE_ID=$(echo "$DEVICE" | jq -r '.id')
    MONITORING_ENABLED=$(echo "$DEVICE" | jq -r '.monitoringEnabled')
    LIBRENMS_ID=$(echo "$DEVICE" | jq -r '.libreNmsId // "null"')
    LIBRENMS_STATUS=$(echo "$DEVICE" | jq -r '.libreNmsStatus // "null"')

    echo -e "${GREEN}Device ID:${NC} $DEVICE_ID"
    echo -e "${GREEN}Monitoring Enabled:${NC} $MONITORING_ENABLED"
    echo -e "${GREEN}LibreNMS ID:${NC} $LIBRENMS_ID"
    echo -e "${GREEN}LibreNMS Status:${NC} $LIBRENMS_STATUS"
    echo ""

    # Check for related jobs
    echo -e "${BLUE}=== Recent Jobs ===${NC}\n"

    for STATUS in completed failed active; do
        JOBS=$(curl -s "$API_URL/queues/librenms-sync/jobs?status=$STATUS&start=0&end=50" \
            -H "Authorization: Bearer $TOKEN" | \
            jq -r ".[] | select(.data.deviceId == $DEVICE_ID)")

        if [ -n "$JOBS" ]; then
            echo -e "${YELLOW}$STATUS jobs:${NC}"
            echo "$JOBS" | jq -r '
                "  Job ID: \(.id)\n  Action: \(.data.action)\n  State: \(.state)\n  Progress: \(.progress)%\n  Result: \(.returnValue // {})\n"'
        fi
    done
}

# Main menu
case "${1:-overview}" in
    overview|o)
        show_overview
        ;;
    jobs|j)
        if [ -z "$2" ]; then
            echo "Usage: $0 jobs <queue-name> [status]"
            echo "Example: $0 jobs librenms-sync completed"
            exit 1
        fi
        show_queue_jobs "$2" "${3:-active}"
        ;;
    watch|w)
        if [ -z "$2" ]; then
            echo "Usage: $0 watch <queue-name>"
            echo "Example: $0 watch librenms-sync"
            exit 1
        fi
        watch_queue "$2"
        ;;
    logs|l)
        case "${2:-worker}" in
            worker)
                show_librenms_logs
                ;;
            backend)
                show_backend_logs
                ;;
            scheduler)
                show_scheduler_logs
                ;;
            all)
                show_backend_logs
                echo ""
                show_librenms_logs
                echo ""
                show_scheduler_logs
                ;;
            *)
                echo "Usage: $0 logs [worker|backend|scheduler|all]"
                exit 1
                ;;
        esac
        ;;
    device|d)
        if [ -z "$2" ]; then
            echo "Usage: $0 device <device-name>"
            echo "Example: $0 device 4WNET-BVA-BRT"
            exit 1
        fi
        check_device "$2"
        ;;
    help|h)
        echo "NetBox Ops Center - Queue Monitoring"
        echo ""
        echo "Usage: $0 [command] [options]"
        echo ""
        echo "Commands:"
        echo "  overview (o)           - Show overview of all queues"
        echo "  jobs (j) <queue> [status] - Show jobs for a specific queue"
        echo "  watch (w) <queue>      - Watch queue in real-time"
        echo "  logs (l) [worker|backend|scheduler|all] - Show logs"
        echo "  device (d) <name>      - Check device status and related jobs"
        echo "  help (h)               - Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 overview"
        echo "  $0 jobs librenms-sync completed"
        echo "  $0 watch librenms-sync"
        echo "  $0 logs worker"
        echo "  $0 device 4WNET-BVA-BRT"
        echo ""
        echo "Environment Variables:"
        echo "  API_URL - API endpoint (default: http://localhost/api)"
        echo "  ~/.netbox-ops-token - Auth token file"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
