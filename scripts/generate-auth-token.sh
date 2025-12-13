#!/bin/bash

# Script para gerar token de autenticação do NetBox Ops Center
# Uso: ./scripts/generate-auth-token.sh <email> <password>

set -e

EMAIL="${1}"
PASSWORD="${2}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
    echo "Uso: $0 <email> <password>"
    echo "Exemplo: $0 admin@example.com mypassword"
    exit 1
fi

# Fazer login e obter token
echo "Gerando token para $EMAIL..."

TOKEN=$(curl -s http://localhost/api/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | \
    jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
    echo "❌ Erro ao gerar token. Verifique email e senha."
    exit 1
fi

echo "✅ Token gerado com sucesso!"
echo ""
echo "Token: $TOKEN"
echo ""
echo "Salvando em ~/.netbox-ops-token..."
echo "$TOKEN" > ~/.netbox-ops-token
chmod 600 ~/.netbox-ops-token
echo "✅ Token salvo!"
echo ""
echo "Agora você pode usar os scripts de monitoramento:"
echo "  ./scripts/monitor-queues.sh overview"
echo "  ./scripts/monitor-queues.sh device 4WNET-BVA-BRT"
