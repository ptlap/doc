#!/bin/bash

# Full RBAC Testing Script - All Modules
# Tests RBAC implementation across Auth, Upload, Projects, and Processing modules

set -e

BASE_URL="http://localhost:3001"
ADMIN_EMAIL="admin@aidoc.com"
ADMIN_PASSWORD="admin123"
USER_EMAIL="user@aidoc.com"
USER_PASSWORD="user123"

echo "🧪 Starting Full RBAC Testing..."
echo "Testing Auth, Upload, Projects, and Processing modules"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to make HTTP requests
make_request() {
    local method=$1
    local url=$2
    local token=$3
    local data=$4
    
    if [ -n "$token" ]; then
        if [ -n "$data" ]; then
            curl -s -X "$method" "$BASE_URL$url" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token" \
                -d "$data" \
                -w "\nHTTP_STATUS:%{http_code}\n"
        else
            curl -s -X "$method" "$BASE_URL$url" \
                -H "Authorization: Bearer $token" \
                -w "\nHTTP_STATUS:%{http_code}\n"
        fi
    else
        curl -s -X "$method" "$BASE_URL$url" \
            -w "\nHTTP_STATUS:%{http_code}\n"
    fi
}

# Function to extract token from login response
extract_token() {
    echo "$1" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4
}

# Function to extract HTTP status
extract_status() {
    echo "$1" | grep "HTTP_STATUS:" | cut -d':' -f2
}

# Login as Admin and User
echo -e "${BLUE}🔐 Authentication Setup${NC}"
admin_login_response=$(make_request "POST" "/auth/login" "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
admin_token=$(extract_token "$admin_login_response")

user_login_response=$(make_request "POST" "/auth/login" "" "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}")
user_token=$(extract_token "$user_login_response")

if [ -z "$admin_token" ] || [ -z "$user_token" ]; then
    echo -e "${RED}❌ Failed to get tokens. Exiting.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Admin and User tokens obtained${NC}"

# Test counters
total_tests=0
passed_tests=0

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local token=$3
    local expected_status=$4
    local description=$5
    
    ((total_tests++))
    
    response=$(make_request "$method" "$endpoint" "$token")
    actual_status=$(extract_status "$response")
    
    if [ "$actual_status" = "$expected_status" ]; then
        echo -e "${GREEN}✅ $description (Status: $actual_status)${NC}"
        ((passed_tests++))
    else
        echo -e "${RED}❌ $description (Expected: $expected_status, Got: $actual_status)${NC}"
    fi
}

# 1. AUTH MODULE TESTS
echo -e "\n${BLUE}📋 1. Auth Module RBAC Tests${NC}"

# Admin endpoints - Admin should pass, User should fail
test_endpoint "GET" "/auth/admin/users" "$admin_token" "200" "Admin accessing admin/users"
test_endpoint "GET" "/auth/admin/users" "$user_token" "403" "User accessing admin/users (should fail)"

test_endpoint "GET" "/auth/admin/stats" "$admin_token" "200" "Admin accessing admin/stats"
test_endpoint "GET" "/auth/admin/stats" "$user_token" "403" "User accessing admin/stats (should fail)"

# User endpoints - Both should pass
test_endpoint "GET" "/auth/user/dashboard" "$admin_token" "200" "Admin accessing user/dashboard"
test_endpoint "GET" "/auth/user/dashboard" "$user_token" "200" "User accessing user/dashboard"

# 2. PROJECTS MODULE TESTS
echo -e "\n${BLUE}📁 2. Projects Module RBAC Tests${NC}"

# All project endpoints should allow USER and ADMIN
test_endpoint "GET" "/projects" "$admin_token" "200" "Admin accessing projects list"
test_endpoint "GET" "/projects" "$user_token" "200" "User accessing projects list"

# Test no token access (should fail)
test_endpoint "GET" "/projects" "" "401" "No token accessing projects (should fail)"

# 3. UPLOAD MODULE TESTS  
echo -e "\n${BLUE}📤 3. Upload Module RBAC Tests${NC}"

# Upload endpoints should allow USER and ADMIN
test_endpoint "GET" "/upload/progress/test-id" "$admin_token" "404" "Admin accessing upload progress (404 expected - no doc)"
test_endpoint "GET" "/upload/progress/test-id" "$user_token" "404" "User accessing upload progress (404 expected - no doc)"

# Test no token access (should fail)
test_endpoint "GET" "/upload/progress/test-id" "" "401" "No token accessing upload (should fail)"

# 4. PROCESSING MODULE TESTS
echo -e "\n${BLUE}⚙️ 4. Processing Module RBAC Tests${NC}"

# Processing endpoints should allow USER and ADMIN
test_endpoint "GET" "/processing/supported-types" "$admin_token" "200" "Admin accessing supported types"
test_endpoint "GET" "/processing/supported-types" "$user_token" "200" "User accessing supported types"

test_endpoint "GET" "/processing/documents/test-id/progress" "$admin_token" "404" "Admin accessing processing progress (404 expected)"
test_endpoint "GET" "/processing/documents/test-id/progress" "$user_token" "404" "User accessing processing progress (404 expected)"

# Test no token access (should fail)
test_endpoint "GET" "/processing/supported-types" "" "401" "No token accessing processing (should fail)"

# 5. INVALID TOKEN TESTS
echo -e "\n${BLUE}🔒 5. Invalid Token Tests${NC}"

test_endpoint "GET" "/auth/admin/users" "invalid_token" "401" "Invalid token accessing admin endpoint"
test_endpoint "GET" "/projects" "invalid_token" "401" "Invalid token accessing projects"
test_endpoint "GET" "/upload/progress/test" "invalid_token" "401" "Invalid token accessing upload"
test_endpoint "GET" "/processing/supported-types" "invalid_token" "401" "Invalid token accessing processing"

# Summary
echo -e "\n${YELLOW}=================================================${NC}"
echo -e "${YELLOW}🎯 Full RBAC Test Summary${NC}"
echo -e "${YELLOW}=================================================${NC}"

echo -e "Total tests: $total_tests"
echo -e "Passed tests: ${GREEN}$passed_tests${NC}"
echo -e "Failed tests: ${RED}$((total_tests - passed_tests))${NC}"

if [ "$passed_tests" = "$total_tests" ]; then
    echo -e "\n${GREEN}🎉 All RBAC tests passed! System is fully secured.${NC}"
    echo -e "${GREEN}✅ Auth Module: Secured${NC}"
    echo -e "${GREEN}✅ Projects Module: Secured${NC}"
    echo -e "${GREEN}✅ Upload Module: Secured${NC}"
    echo -e "${GREEN}✅ Processing Module: Secured${NC}"
    exit 0
else
    echo -e "\n${RED}⚠️  Some tests failed. Please check the implementation.${NC}"
    echo -e "Success rate: $(( passed_tests * 100 / total_tests ))%"
    exit 1
fi