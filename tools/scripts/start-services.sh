#!/bin/bash

# AI Document Assistant - Start Services
# Quick script to start infrastructure services

set -e

echo "🚀 Starting AI Document Assistant services..."

# Navigate to project root
cd "$(dirname "$0")/../.."

# Start services
echo "Starting PostgreSQL, Redis, and MinIO..."
docker compose -f tools/docker/docker-compose.yml up -d postgres redis minio

echo "✅ Services started!"
echo ""
echo "📊 Services running:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379" 
echo "  - MinIO API: localhost:9000"
echo "  - MinIO Console: http://localhost:9001"
echo ""
echo "🔍 Check status: docker compose -f tools/docker/docker-compose.yml ps"
echo "📋 View logs: docker compose -f tools/docker/docker-compose.yml logs -f"