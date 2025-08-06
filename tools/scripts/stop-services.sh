#!/bin/bash

# AI Document Assistant - Stop Services
# Quick script to stop infrastructure services

set -e

echo "🛑 Stopping AI Document Assistant services..."

# Navigate to project root
cd "$(dirname "$0")/../.."

# Stop services
echo "Stopping PostgreSQL, Redis, and MinIO..."
docker compose -f tools/docker/docker-compose.yml down

echo "✅ Services stopped!"
echo ""
echo "💡 To start again: ./tools/scripts/start-services.sh"
echo "🔄 To reset data: ./tools/scripts/reset-dev.sh"