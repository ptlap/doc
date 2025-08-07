#!/bin/bash

# Simple API Testing Script for AI Document Assistant
# Quick tests for main endpoints

BASE_URL="http://localhost:3001"

echo "🚀 Testing AI Document Assistant API"
echo "Base URL: $BASE_URL"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4
    local headers=$5
    
    echo -e "${YELLOW}Testing: $description${NC}"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "%{http_code}" -X $method $headers "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "%{http_code}" -X $method $headers -d "$data" "$BASE_URL$endpoint")
    fi
    
    http_code="${response: -3}"
    body="${response%???}"
    
    if [[ $http_code -ge 200 && $http_code -lt 300 ]]; then
        echo -e "${GREEN}✓ $method $endpoint - $http_code${NC}"
    else
        echo -e "${RED}✗ $method $endpoint - $http_code${NC}"
    fi
    
    if [ ${#body} -gt 0 ] && [ ${#body} -lt 200 ]; then
        echo "   Response: $body"
    fi
    echo ""
}

echo "=== BASIC HEALTH CHECKS ==="
test_endpoint "GET" "/" "Root endpoint"
test_endpoint "GET" "/health" "Health check"

echo "=== AUTHENTICATION ENDPOINTS ==="
test_endpoint "POST" "/auth/register" "User registration" \
    '{"email":"test4@example.com","password":"TestPassword123!","name":"Test User 4"}' \
    "-H 'Content-Type: application/json'"

test_endpoint "POST" "/auth/login" "User login" \
    '{"email":"test@example.com","password":"TestPassword123!"}' \
    "-H 'Content-Type: application/json'"

echo "=== PUBLIC ENDPOINTS ==="
test_endpoint "GET" "/processing/supported-types" "Get supported file types"

echo "=== DOCUMENTATION ==="
echo "📚 API Documentation available at: $BASE_URL/api/docs"
echo ""

echo "🔐 For authenticated endpoints, you need to:"
echo "1. Register/Login to get access token"
echo "2. Use token in Authorization header: 'Bearer <token>'"
echo ""

echo "📝 For complete testing, run: ./test-api-curl.sh"
echo "🚀 To start the server: cd apps/backend && pnpm run dev"
