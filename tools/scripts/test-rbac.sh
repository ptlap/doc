#!/bin/bash

# RBAC Testing Script
# This script tests the Role-Based Access Control implementation

set -e

BASE_URL="http://localhost:3001"
ADMIN_EMAIL="admin@aidoc.com"
ADMIN_PASSWORD="admin123"
USER_EMAIL="user@aidoc.com"
USER_PASSWORD="user123"

echo "🧪 Starting RBAC Testing..."
echo "================================"

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
        if [ -n "$data" ]; then
            curl -s -X "$method" "$BASE_URL$url" \
                -H "Content-Type: application/json" \
                -d "$data" \
                -w "\nHTTP_STATUS:%{http_code}\n"
        else
            curl -s -X "$method" "$BASE_URL$url" \
                -w "\nHTTP_STATUS:%{http_code}\n"
        fi
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

# Test 1: Login as Admin
echo -e "${BLUE}Test 1: Admin Login${NC}"
admin_login_response=$(make_request "POST" "/auth/login" "" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
admin_status=$(extract_status "$admin_login_response")
admin_token=$(extract_token "$admin_login_response")

if [ "$admin_status" = "200" ] && [ -n "$admin_token" ]; then
    echo -e "${GREEN}✅ Admin login successful${NC}"
    echo "Admin token: ${admin_token:0:20}..."
else
    echo -e "${RED}❌ Admin login failed (Status: $admin_status)${NC}"
    exit 1
fi

# Test 2: Login as User
echo -e "\n${BLUE}Test 2: User Login${NC}"
user_login_response=$(make_request "POST" "/auth/login" "" "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}")
user_status=$(extract_status "$user_login_response")
user_token=$(extract_token "$user_login_response")

if [ "$user_status" = "200" ] && [ -n "$user_token" ]; then
    echo -e "${GREEN}✅ User login successful${NC}"
    echo "User token: ${user_token:0:20}..."
else
    echo -e "${RED}❌ User login failed (Status: $user_status)${NC}"
    exit 1
fi

# Test 3: Admin accessing admin endpoints
echo -e "\n${BLUE}Test 3: Admin accessing admin endpoints${NC}"

# Test 3.1: Admin users endpoint
admin_users_response=$(make_request "GET" "/auth/admin/users" "$admin_token")
admin_users_status=$(extract_status "$admin_users_response")

if [ "$admin_users_status" = "200" ]; then
    echo -e "${GREEN}✅ Admin can access /auth/admin/users (Status: $admin_users_status)${NC}"
else
    echo -e "${RED}❌ Admin cannot access /auth/admin/users (Status: $admin_users_status)${NC}"
fi

# Test 3.2: Admin stats endpoint
admin_stats_response=$(make_request "GET" "/auth/admin/stats" "$admin_token")
admin_stats_status=$(extract_status "$admin_stats_response")

if [ "$admin_stats_status" = "200" ]; then
    echo -e "${GREEN}✅ Admin can access /auth/admin/stats (Status: $admin_stats_status)${NC}"
else
    echo -e "${RED}❌ Admin cannot access /auth/admin/stats (Status: $admin_stats_status)${NC}"
fi

# Test 4: Admin accessing user endpoints
echo -e "\n${BLUE}Test 4: Admin accessing user endpoints${NC}"

admin_dashboard_response=$(make_request "GET" "/auth/user/dashboard" "$admin_token")
admin_dashboard_status=$(extract_status "$admin_dashboard_response")

if [ "$admin_dashboard_status" = "200" ]; then
    echo -e "${GREEN}✅ Admin can access /auth/user/dashboard (Status: $admin_dashboard_status)${NC}"
else
    echo -e "${RED}❌ Admin cannot access /auth/user/dashboard (Status: $admin_dashboard_status)${NC}"
fi

# Test 5: User accessing user endpoints
echo -e "\n${BLUE}Test 5: User accessing user endpoints${NC}"

user_dashboard_response=$(make_request "GET" "/auth/user/dashboard" "$user_token")
user_dashboard_status=$(extract_status "$user_dashboard_response")

if [ "$user_dashboard_status" = "200" ]; then
    echo -e "${GREEN}✅ User can access /auth/user/dashboard (Status: $user_dashboard_status)${NC}"
else
    echo -e "${RED}❌ User cannot access /auth/user/dashboard (Status: $user_dashboard_status)${NC}"
fi

# Test 6: User accessing admin endpoints (should fail)
echo -e "\n${BLUE}Test 6: User accessing admin endpoints (should fail)${NC}"

# Test 6.1: User trying admin users endpoint
user_admin_users_response=$(make_request "GET" "/auth/admin/users" "$user_token")
user_admin_users_status=$(extract_status "$user_admin_users_response")

if [ "$user_admin_users_status" = "403" ]; then
    echo -e "${GREEN}✅ User correctly denied access to /auth/admin/users (Status: $user_admin_users_status)${NC}"
else
    echo -e "${RED}❌ User should be denied access to /auth/admin/users (Status: $user_admin_users_status)${NC}"
fi

# Test 6.2: User trying admin stats endpoint
user_admin_stats_response=$(make_request "GET" "/auth/admin/stats" "$user_token")
user_admin_stats_status=$(extract_status "$user_admin_stats_response")

if [ "$user_admin_stats_status" = "403" ]; then
    echo -e "${GREEN}✅ User correctly denied access to /auth/admin/stats (Status: $user_admin_stats_status)${NC}"
else
    echo -e "${RED}❌ User should be denied access to /auth/admin/stats (Status: $user_admin_stats_status)${NC}"
fi

# Test 7: No token access (should fail)
echo -e "\n${BLUE}Test 7: No token access (should fail)${NC}"

no_token_response=$(make_request "GET" "/auth/admin/users" "")
no_token_status=$(extract_status "$no_token_response")

if [ "$no_token_status" = "401" ]; then
    echo -e "${GREEN}✅ No token correctly denied access (Status: $no_token_status)${NC}"
else
    echo -e "${RED}❌ No token should be denied access (Status: $no_token_status)${NC}"
fi

# Test 8: Invalid token access (should fail)
echo -e "\n${BLUE}Test 8: Invalid token access (should fail)${NC}"

invalid_token_response=$(make_request "GET" "/auth/admin/users" "invalid_token_here")
invalid_token_status=$(extract_status "$invalid_token_response")

if [ "$invalid_token_status" = "401" ]; then
    echo -e "${GREEN}✅ Invalid token correctly denied access (Status: $invalid_token_status)${NC}"
else
    echo -e "${RED}❌ Invalid token should be denied access (Status: $invalid_token_status)${NC}"
fi

# Summary
echo -e "\n${YELLOW}================================${NC}"
echo -e "${YELLOW}🎯 RBAC Test Summary${NC}"
echo -e "${YELLOW}================================${NC}"

# Count successful tests
total_tests=8
passed_tests=0

# Check each test result (simplified)
if [ "$admin_status" = "200" ]; then ((passed_tests++)); fi
if [ "$user_status" = "200" ]; then ((passed_tests++)); fi
if [ "$admin_users_status" = "200" ]; then ((passed_tests++)); fi
if [ "$admin_stats_status" = "200" ]; then ((passed_tests++)); fi
if [ "$admin_dashboard_status" = "200" ]; then ((passed_tests++)); fi
if [ "$user_dashboard_status" = "200" ]; then ((passed_tests++)); fi
if [ "$user_admin_users_status" = "403" ]; then ((passed_tests++)); fi
if [ "$user_admin_stats_status" = "403" ]; then ((passed_tests++)); fi

echo -e "Tests passed: ${GREEN}$passed_tests/$total_tests${NC}"

if [ "$passed_tests" = "$total_tests" ]; then
    echo -e "${GREEN}🎉 All RBAC tests passed! System is working correctly.${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Please check the implementation.${NC}"
    exit 1
fi