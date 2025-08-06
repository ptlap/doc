#!/bin/bash

# AI Document Assistant - Reset Development Environment
# This script resets the development environment to a clean state

set -e

echo "🔄 Resetting AI Document Assistant development environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Navigate to project root
cd "$(dirname "$0")/../.."

# Stop all services
print_status "Stopping all services..."
docker compose -f tools/docker/docker-compose.yml down

# Remove volumes (this will delete all data)
print_warning "This will delete ALL data including database, Redis cache, and MinIO files!"
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Reset cancelled."
    exit 0
fi

print_status "Removing Docker volumes..."
docker compose -f tools/docker/docker-compose.yml down -v

# Clean up local storage directories
print_status "Cleaning up local storage..."
rm -rf apps/backend/temp/*
rm -rf apps/backend/storage/*

# Remove node_modules and reinstall (optional)
read -p "Do you want to reinstall dependencies? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Removing node_modules..."
    rm -rf node_modules
    rm -rf apps/*/node_modules
    rm -rf packages/*/node_modules
    
    print_status "Reinstalling dependencies..."
    pnpm install
fi

print_success "Development environment has been reset!"
echo ""
echo "🚀 To set up again, run:"
echo "  ./tools/scripts/dev-setup.sh"