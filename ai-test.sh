#!/bin/bash

# AI Integration Test Script
BASE_URL="http://localhost:3001"

echo "=== Testing AI Integration ==="

# First, login to get token
echo "1. Logging in..."
TOKEN=$(curl -s -X POST $BASE_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | \
  jq -r '.token')

if [ "$TOKEN" = "null" ]; then
  echo "❌ Login failed. Make sure user exists."
  exit 1
fi

echo "✅ Login successful"

# Test AI service health
echo "2. Testing AI service health..."
curl -s -H "Authorization: Bearer $TOKEN" \
  $BASE_URL/api/ai/health | jq '.'

# Test quick summary
echo "3. Testing quick summary..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/updates/quick-summary" | jq '.'

# Test summarized updates
echo "4. Testing AI-summarized updates..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/updates/summarized?type=quick" | jq '.'

# Test detailed analysis
echo "5. Testing detailed analysis..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/updates/detailed-analysis?days=1" | jq '.'

# Test refresh and summarize
echo "6. Testing refresh with AI summary..."
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  $BASE_URL/api/subscriptions/refresh-and-summarize | jq '.'

echo "=== AI Integration Tests Complete ==="