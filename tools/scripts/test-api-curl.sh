#!/bin/bash

# AI Document Assistant - Comprehensive API Testing Script
# This script tests all API endpoints using curl commands

# Configuration
BASE_URL="http://localhost:3001"
API_DOCS_URL="$BASE_URL/api/docs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Global variables for tokens
ACCESS_TOKEN=""
REFRESH_TOKEN=""
USER_ID=""
PROJECT_ID=""
DOCUMENT_ID=""

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}Testing: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Function to make curl request and handle response
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local headers=$4
    local description=$5
    
    print_test "$description"
    
    local curl_cmd="curl -s -w '\n%{http_code}' -X $method"
    
    if [ ! -z "$headers" ]; then
        curl_cmd="$curl_cmd $headers"
    fi
    
    if [ ! -z "$data" ]; then
        curl_cmd="$curl_cmd -d '$data'"
    fi
    
    curl_cmd="$curl_cmd '$BASE_URL$endpoint'"
    
    echo "Command: $curl_cmd"
    
    local response=$(eval $curl_cmd)
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    echo "Response Code: $http_code"
    echo "Response Body: $body"
    
    if [[ $http_code -ge 200 && $http_code -lt 300 ]]; then
        print_success "Request successful"
        echo "$body"
    else
        print_error "Request failed with code $http_code"
        echo "$body"
    fi
    
    echo ""
    return $http_code
}

# Function to extract value from JSON response
extract_json_value() {
    local json=$1
    local key=$2
    echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d'"' -f4
}

# Test functions
test_health_check() {
    print_header "HEALTH CHECK TESTS"
    
    make_request "GET" "/" "" "" "Root endpoint"
    make_request "GET" "/health" "" "" "Health check endpoint"
}

test_auth_endpoints() {
    print_header "AUTHENTICATION TESTS"
    
    # Test user registration
    local register_data='{
        "email": "test@example.com",
        "password": "TestPassword123!",
        "name": "Test User"
    }'
    
    local response=$(make_request "POST" "/auth/register" "$register_data" "-H 'Content-Type: application/json'" "User registration")
    
    # Test user login
    local login_data='{
        "email": "test@example.com",
        "password": "TestPassword123!"
    }'
    
    response=$(make_request "POST" "/auth/login" "$login_data" "-H 'Content-Type: application/json'" "User login")
    
    # Extract tokens from login response
    ACCESS_TOKEN=$(echo "$response" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
    REFRESH_TOKEN=$(echo "$response" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)
    USER_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ ! -z "$ACCESS_TOKEN" ]; then
        print_success "Access token obtained: ${ACCESS_TOKEN:0:20}..."
        export ACCESS_TOKEN
        export REFRESH_TOKEN
        export USER_ID
    else
        print_error "Failed to obtain access token"
    fi
    
    # Test profile endpoint (requires authentication)
    if [ ! -z "$ACCESS_TOKEN" ]; then
        make_request "GET" "/auth/profile" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get user profile"
    fi
    
    # Test token refresh
    if [ ! -z "$REFRESH_TOKEN" ]; then
        local refresh_data="{\"refreshToken\": \"$REFRESH_TOKEN\"}"
        make_request "POST" "/auth/refresh" "$refresh_data" "-H 'Content-Type: application/json'" "Refresh token"
    fi
}

test_projects_endpoints() {
    print_header "PROJECTS TESTS"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available. Skipping projects tests."
        return
    fi
    
    local auth_header="-H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'"
    
    # Create a project
    local project_data='{
        "name": "Test Project",
        "description": "A test project for API testing"
    }'
    
    local response=$(make_request "POST" "/projects" "$project_data" "$auth_header" "Create project")
    PROJECT_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    
    if [ ! -z "$PROJECT_ID" ]; then
        print_success "Project created with ID: $PROJECT_ID"
        export PROJECT_ID
    fi
    
    # Get all projects
    make_request "GET" "/projects" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get all projects"
    
    # Get specific project
    if [ ! -z "$PROJECT_ID" ]; then
        make_request "GET" "/projects/$PROJECT_ID" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get project by ID"
        
        # Update project
        local update_data='{
            "name": "Updated Test Project",
            "description": "Updated description"
        }'
        make_request "PATCH" "/projects/$PROJECT_ID" "$update_data" "$auth_header" "Update project"
        
        # Get project stats
        make_request "GET" "/projects/$PROJECT_ID/stats" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get project stats"
    fi
}

test_upload_endpoints() {
    print_header "UPLOAD TESTS"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available. Skipping upload tests."
        return
    fi
    
    # Create a test file
    echo "This is a test document for API testing." > test_document.txt
    
    # Test file upload
    local response=$(curl -s -w '\n%{http_code}' \
        -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -F "file=@test_document.txt" \
        -F "projectId=$PROJECT_ID" \
        "$BASE_URL/upload/document")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    print_test "Upload document"
    echo "Response Code: $http_code"
    echo "Response Body: $body"
    
    if [[ $http_code -ge 200 && $http_code -lt 300 ]]; then
        print_success "Document uploaded successfully"
        DOCUMENT_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        if [ ! -z "$DOCUMENT_ID" ]; then
            print_success "Document ID: $DOCUMENT_ID"
            export DOCUMENT_ID
        fi
    else
        print_error "Document upload failed"
    fi
    
    # Test file validation
    local validate_response=$(curl -s -w '\n%{http_code}' \
        -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -F "file=@test_document.txt" \
        "$BASE_URL/upload/validate")
    
    print_test "Validate file"
    echo "Validation response: $validate_response"
    
    # Clean up test file
    rm -f test_document.txt
    
    # Test other upload endpoints if document was uploaded
    if [ ! -z "$DOCUMENT_ID" ]; then
        make_request "GET" "/upload/progress/$DOCUMENT_ID" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get upload progress"
        make_request "GET" "/upload/file/$DOCUMENT_ID" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get uploaded file"
        make_request "GET" "/upload/preview/$DOCUMENT_ID" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get file preview"
    fi
}

test_processing_endpoints() {
    print_header "PROCESSING TESTS"
    
    if [ -z "$ACCESS_TOKEN" ] || [ -z "$DOCUMENT_ID" ]; then
        print_error "No access token or document ID available. Skipping processing tests."
        return
    fi
    
    local auth_header="-H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'"
    
    # Get supported file types
    make_request "GET" "/processing/supported-types" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get supported file types"
    
    # Process document
    make_request "POST" "/processing/documents/$DOCUMENT_ID/process" "" "$auth_header" "Process document"
    
    # Get processing progress
    make_request "GET" "/processing/documents/$DOCUMENT_ID/progress" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get processing progress"
    
    # Get document pages
    make_request "GET" "/processing/documents/$DOCUMENT_ID/pages" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get document pages"
    
    # Get document chunks
    make_request "GET" "/processing/documents/$DOCUMENT_ID/chunks" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Get document chunks"
    
    # Reprocess document
    make_request "POST" "/processing/documents/$DOCUMENT_ID/reprocess" "" "$auth_header" "Reprocess document"
}

test_chat_endpoints() {
    print_header "CHAT TESTS"
    
    if [ -z "$ACCESS_TOKEN" ] || [ -z "$PROJECT_ID" ]; then
        print_error "No access token or project ID available. Skipping chat tests."
        return
    fi
    
    # Note: Chat endpoints might require WebSocket connection
    # For HTTP endpoints, we can test basic functionality
    
    print_info "Chat functionality typically uses WebSocket connections"
    print_info "Testing basic chat-related HTTP endpoints if available"
    
    # Test any HTTP chat endpoints that might exist
    # This would depend on the actual implementation
}

test_admin_endpoints() {
    print_header "ADMIN TESTS"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available. Skipping admin tests."
        return
    fi
    
    print_info "Admin endpoints require admin privileges"
    print_info "These tests may fail if the test user is not an admin"
    
    local auth_header="-H 'Authorization: Bearer $ACCESS_TOKEN'"
    
    # Test admin dashboard
    make_request "GET" "/admin/dashboard" "" "$auth_header" "Get admin dashboard"
    
    # Test system health
    make_request "GET" "/admin/system/health" "" "$auth_header" "Get system health"
    
    # Test usage analytics
    make_request "GET" "/admin/analytics/usage" "" "$auth_header" "Get usage analytics"
    
    # Test user management
    make_request "GET" "/admin/users" "" "$auth_header" "Get all users"
    
    # Test project management
    make_request "GET" "/admin/projects" "" "$auth_header" "Get all projects (admin)"
    
    # Test document management
    make_request "GET" "/admin/documents" "" "$auth_header" "Get all documents (admin)"
}

test_management_endpoints() {
    print_header "MANAGEMENT TESTS"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "No access token available. Skipping management tests."
        return
    fi
    
    print_info "Management endpoints require admin privileges"
    print_info "These tests may fail if the test user is not an admin"
    
    local auth_header="-H 'Authorization: Bearer $ACCESS_TOKEN'"
    
    # Test configuration
    make_request "GET" "/management/config" "" "$auth_header" "Get system configuration"
    
    # Test monitoring metrics
    make_request "GET" "/management/monitoring/metrics" "" "$auth_header" "Get monitoring metrics"
    
    # Test monitoring alerts
    make_request "GET" "/management/monitoring/alerts" "" "$auth_header" "Get monitoring alerts"
    
    # Test security audit logs
    make_request "GET" "/management/security/audit-logs" "" "$auth_header" "Get audit logs"
    
    # Test active sessions
    make_request "GET" "/management/security/sessions" "" "$auth_header" "Get active sessions"
    
    # Test performance reports
    make_request "GET" "/management/performance/reports" "" "$auth_header" "Get performance reports"
    
    # Test backups
    make_request "GET" "/management/backups" "" "$auth_header" "Get backup list"
}

test_cleanup() {
    print_header "CLEANUP"
    
    if [ -z "$ACCESS_TOKEN" ]; then
        print_info "No access token available. Skipping cleanup."
        return
    fi
    
    # Delete test project if it was created
    if [ ! -z "$PROJECT_ID" ]; then
        print_test "Deleting test project"
        make_request "DELETE" "/projects/$PROJECT_ID" "" "-H 'Authorization: Bearer $ACCESS_TOKEN'" "Delete test project"
    fi
    
    # Logout
    make_request "POST" "/auth/logout" "" "-H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json'" "User logout"
}

# Main execution
main() {
    print_header "AI DOCUMENT ASSISTANT API TESTING"
    print_info "Base URL: $BASE_URL"
    print_info "API Documentation: $API_DOCS_URL"
    print_info "Starting comprehensive API tests..."
    
    # Check if server is running
    if ! curl -s "$BASE_URL/health" > /dev/null; then
        print_error "Server is not running at $BASE_URL"
        print_info "Please start the server with: cd apps/backend && pnpm run dev"
        exit 1
    fi
    
    print_success "Server is running"
    
    # Run all tests
    test_health_check
    test_auth_endpoints
    test_projects_endpoints
    test_upload_endpoints
    test_processing_endpoints
    test_chat_endpoints
    test_admin_endpoints
    test_management_endpoints
    test_cleanup
    
    print_header "TESTING COMPLETED"
    print_info "Check the output above for any failed tests"
    print_info "For detailed API documentation, visit: $API_DOCS_URL"
}

# Run the main function
main "$@"
