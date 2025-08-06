#!/bin/bash

# AI Document Assistant - Development Setup Script
# This script sets up the development environment

set -e

echo "🚀 Setting up AI Document Assistant development environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Docker is running ✓"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    print_error "pnpm is not installed. Please install pnpm first:"
    echo "npm install -g pnpm"
    exit 1
fi

print_status "pnpm is installed ✓"

# Navigate to project root
cd "$(dirname "$0")/../.."

# Install dependencies
print_status "Installing dependencies..."
pnpm install

# Start infrastructure services
print_status "Starting infrastructure services (PostgreSQL, Redis, MinIO)..."
docker compose -f tools/docker/docker-compose.yml up -d postgres redis minio

# Wait for services to be healthy
print_status "Waiting for services to be ready..."
sleep 10

# Setup MinIO bucket
print_status "Setting up MinIO bucket..."
cd apps/backend
pnpm exec tsx ../../tools/scripts/setup-minio.ts

# Run database migrations
print_status "Running database migrations..."
pnpm exec prisma migrate dev --name init

# Seed database
print_status "Seeding database with sample data..."
pnpm exec tsx prisma/seed.ts

cd ../..

print_success "Development environment setup completed!"
echo ""
echo "📊 Services running:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"
echo "  - MinIO API: localhost:9000"
echo "  - MinIO Console: http://localhost:9001"
echo ""
echo "🔑 MinIO Credentials:"
echo "  - Username: minioadmin"
echo "  - Password: minioadmin123"
echo ""
echo "🚀 Next steps:"
echo "  1. Start backend: cd apps/backend && pnpm dev"
echo "  2. Start frontend: cd apps/frontend && pnpm dev"
echo "  3. Open http://localhost:3000"
echo ""
echo "🛠️  Useful commands:"
echo "  - Stop services: docker compose -f tools/docker/docker-compose.yml down"
echo "  - View logs: docker compose -f tools/docker/docker-compose.yml logs -f"
echo "  - Reset data: ./tools/scripts/reset-dev.sh"