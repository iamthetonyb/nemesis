#!/usr/bin/env bash
# Creates a Cloudflare Turnstile widget for USA Spending Watch on gov-budget.pages.dev
# and injects the site key into frontend/assets/js/config.js
#
# Usage:
#   CF_API_TOKEN=<token-with-challenge_widgets:edit> ./tools/setup-turnstile.sh
#
# Get a token at: https://dash.cloudflare.com/profile/api-tokens
# Required permission: Account > Turnstile > Edit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_JS="$SCRIPT_DIR/../frontend/assets/js/config.js"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "Error: CF_API_TOKEN is not set"
  echo "Usage: CF_API_TOKEN=<your-token> $0"
  exit 1
fi

# Get account ID
echo "Fetching Cloudflare account ID..."
ACCOUNT_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result'][0]['id'])")

if [ -z "$ACCOUNT_ID" ]; then
  echo "Error: Could not fetch account ID. Check your API token permissions."
  exit 1
fi

echo "Account ID: $ACCOUNT_ID"
echo "Creating Turnstile widget..."

RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/challenges/widgets" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "USA Spending Watch feedback",
    "domains": ["gov-budget.pages.dev", "usaspending.us"],
    "mode": "managed",
    "bot_fight_mode": false
  }')

SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])")

if [ "$SUCCESS" != "True" ]; then
  echo "Error creating widget:"
  echo "$RESPONSE" | python3 -m json.tool
  exit 1
fi

SITE_KEY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['sitekey'])")
echo "Site key: $SITE_KEY"

# Inject into config.js
if grep -q 'TURNSTILE_SITE_KEY' "$CONFIG_JS"; then
  sed -i '' "s|window.TURNSTILE_SITE_KEY = .*|window.TURNSTILE_SITE_KEY = \"$SITE_KEY\";|" "$CONFIG_JS"
  echo "Injected site key into $CONFIG_JS"
else
  echo "Warning: TURNSTILE_SITE_KEY not found in $CONFIG_JS — add manually:"
  echo "  window.TURNSTILE_SITE_KEY = \"$SITE_KEY\";"
fi

echo ""
echo "Done. Next steps:"
echo "  1. Deploy: pnpm deploy:pages"
echo "  2. Verify the widget at https://gov-budget.pages.dev"
echo "  3. usaspending.us is already included in the widget domains"
