#!/bin/bash

# Navigate to root directory
cd "$(dirname "$0")"

echo "Iniciando Netbox Ops Center HUB (FastAPI)..."

# Ensure dependencies are installed
pip install -r backend/requirements.txt --quiet

# Run from root with PYTHONPATH set to allow absolute imports
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
