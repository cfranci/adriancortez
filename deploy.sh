#!/bin/bash
# One-shot deploy for the adriancortez worker (API KING Cloudflare account).
# Usage: CLOUDFLARE_API_TOKEN=xxx bash deploy.sh   (or put the token in .env)
# Idempotent: provisions KV + D1 if missing, patches wrangler.toml, runs
# migrations, sets ADMIN_KEY, deploys, seeds content, smoke-tests.
set -euo pipefail
cd "$(dirname "$0")"

export CLOUDFLARE_ACCOUNT_ID="d044293fa72b226f3efd250447a870fe"
[ -f .env ] && set -a && source .env && set +a
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (API KING account)}"

API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")

echo "==> Verifying token"
curl -sf "$API/tokens/verify" "${AUTH[@]}" >/dev/null || { echo "Token failed verification against account"; exit 1; }

echo "==> KV namespace"
KV_ID=$(curl -s "$API/storage/kv/namespaces?per_page=100" "${AUTH[@]}" | python3 -c "import sys,json; print(next((n['id'] for n in json.load(sys.stdin)['result'] if n['title'].endswith('SITE')), ''))")
if [ -z "$KV_ID" ]; then
  KV_ID=$(curl -s -X POST "$API/storage/kv/namespaces" "${AUTH[@]}" -H "Content-Type: application/json" -d '{"title":"adriancortez-SITE"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id'])")
  echo "    created $KV_ID"
else echo "    exists $KV_ID"; fi
python3 - "$KV_ID" <<'EOF'
import re, sys
s = open('wrangler.toml').read()
s = re.sub(r'(\[\[kv_namespaces\]\]\nbinding = "SITE"\nid = ")[^"]*(")', r'\g<1>' + sys.argv[1] + r'\g<2>', s)
open('wrangler.toml','w').write(s)
EOF

echo "==> D1 database"
D1_ID=$(curl -s "$API/d1/database?per_page=100" "${AUTH[@]}" | python3 -c "import sys,json; print(next((d['uuid'] for d in json.load(sys.stdin)['result'] if d['name']=='adriancortez-marketing'), ''))")
if [ -z "$D1_ID" ]; then
  D1_ID=$(curl -s -X POST "$API/d1/database" "${AUTH[@]}" -H "Content-Type: application/json" -d '{"name":"adriancortez-marketing"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['uuid'])")
  echo "    created $D1_ID"
else echo "    exists $D1_ID"; fi
grep -q 'd1_databases' wrangler.toml || cat >> wrangler.toml <<EOF

[[d1_databases]]
binding = "DB"
database_name = "adriancortez-marketing"
database_id = "$D1_ID"
EOF
python3 - "$D1_ID" <<'EOF'
import re, sys
s = open('wrangler.toml').read()
s = re.sub(r'(database_id = ")[^"]*(")', r'\g<1>' + sys.argv[1] + r'\g<2>', s)
open('wrangler.toml','w').write(s)
EOF

echo "==> Migrations"
for f in migrations/*.sql; do
  [ -e "$f" ] || continue
  echo "    $f"
  npx wrangler d1 execute adriancortez-marketing --remote --file "$f" -y >/dev/null
done

echo "==> ADMIN_KEY"
if ! grep -q '^ADMIN_KEY=' .env 2>/dev/null; then
  KEY="AC-$(openssl rand -hex 10)"
  touch .env && chmod 600 .env
  echo "ADMIN_KEY=$KEY" >> .env
  echo "    generated (saved to .env)"
else
  KEY=$(grep '^ADMIN_KEY=' .env | cut -d= -f2-)
  echo "    reusing from .env"
fi
printf '%s' "$KEY" | npx wrangler secret put ADMIN_KEY >/dev/null 2>&1 || printf '%s' "$KEY" | npx wrangler secret put ADMIN_KEY

echo "==> Optional marketing secrets (skipped if not in .env)"
for S in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM RESEND_API_KEY EMAIL_FROM; do
  V=$(grep "^$S=" .env 2>/dev/null | cut -d= -f2- || true)
  [ -n "$V" ] && printf '%s' "$V" | npx wrangler secret put "$S" >/dev/null && echo "    set $S"
done

echo "==> Deploy"
npx wrangler deploy

echo "==> Seed content (only if empty)"
EXISTING=$(npx wrangler kv key get content --namespace-id "$KV_ID" --remote 2>/dev/null || true)
if [ -z "$EXISTING" ]; then
  npx wrangler kv key put content --path seed/content.json --namespace-id "$KV_ID" --remote
  echo "    seeded"
else echo "    already has content, left alone"; fi

echo "==> Smoke tests"
SUB=$(curl -s "$API/workers/subdomain" "${AUTH[@]}" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['subdomain'])")
URL="https://adriancortez.$SUB.workers.dev"
sleep 3
for path in "/" "/api/content" "/admin/"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL$path")
  echo "    GET $path -> $CODE"
done
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/api/admin/login" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\"}")
echo "    admin login -> $CODE"
grep -q '^SITE_URL=' .env || echo "SITE_URL=$URL" >> .env

echo
echo "LIVE: $URL"
echo "Admin: $URL/admin/  (key in $(pwd)/.env — send to Adrian out-of-band)"
