#!/usr/bin/env bash
# PUSH-01H: intentionally LOCAL workerd + local D1 (never Cloudflare remote).
set -euo pipefail

ROOT="$PWD"
cd "$ROOT"

# Defense-in-depth: no Cloudflare credentials are available to this runner.
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CF_API_TOKEN
export WRANGLER_SEND_METRICS=false

PORT="$(printenv TS52_LOCAL_WORKER_PORT || echo 8799)"
if ! [[ "$PORT" =~ ^[0-9]{4,5}$ ]]; then
  echo "Invalid local port" >&2
  exit 2
fi
TMP="$(mktemp -d)"
CONFIG="$(mktemp --suffix=.toml "$ROOT/.push01h-ci-local-XXXXXX")"
WORKER_PID=""

cleanup() {
  if [[ -n "$WORKER_PID" ]]; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$CONFIG"
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

# Generated test-only Wrangler config, no real D1 ID or remote URL.
cat >"$CONFIG" <<'TOML'
name = "ts52-push01h-local-only"
main = "src/index.js"
compatibility_date = "2026-06-01"
workers_dev = false

[[d1_databases]]
binding = "DB"
database_name = "ts52-push01h-test-only"
database_id = "00000000-0000-4000-8000-000000000123"
migrations_dir = "migrations"

[vars]
APP_ENV = "staging"
PASSENGER_PUSH_API_ENABLED = "true"
PASSENGER_PUSH_DEVICES_ENABLED = "true"
TOML

if grep -Eq 'transfer-servis52-core|transfer-servis52-staging|^name = "uber-v3"|^name = "uber-v3-staging"' "$CONFIG"; then
  echo "Refusing non-local Wrangler binding" >&2
  exit 2
fi
mkdir -p "$TMP/state"
echo "PUSH01H_WRANGLER_MODE=LOCAL_ONLY"

# Every Wrangler command explicitly includes --local and isolated state.
npx --no-install wrangler d1 migrations apply DB \
  --config "$CONFIG" --local --persist-to "$TMP/state" >"$TMP/migrations.log" 2>&1 || {
  echo "Local D1 migration failed" >&2
  tail -40 "$TMP/migrations.log" >&2
  exit 1
}

SEED="INSERT INTO orders (id,name,phone,route,trip_date,comment,status,created_at,updated_at) VALUES ('68516805-d870-4bc9-ac4a-43995df5bc05','CI fixture','+79990000000','A to B','2026-12-15','','new',1000,1000);"
npx --no-install wrangler d1 execute DB \
  --config "$CONFIG" --local --persist-to "$TMP/state" \
  --command "$SEED" >"$TMP/seed.log" 2>&1 || {
  echo "Local D1 seed failed" >&2
  tail -40 "$TMP/seed.log" >&2
  exit 1
}

npx --no-install wrangler dev \
  --config "$CONFIG" --local --ip 127.0.0.1 --port "$PORT" \
  --persist-to "$TMP/state" \
  --var "PASSENGER_ORDER_SECRET:push01h-ci-passenger-read-fake-key-at-least-32-characters" \
  --var "PASSENGER_PUSH_GRANT_SECRET:push01h-ci-passenger-push-fake-key-at-least-32-characters" \
  --var "PROXY_HMAC_SECRET:push01h-ci-proxy-hmac-fake-key-at-least-32-characters" \
  --var "JWT_SECRET:push01h-ci-staff-unused-fake-key-at-least-32-characters" \
  >"$TMP/workerd.log" 2>&1 &
WORKER_PID="$!"

ready=0
for _ in $(seq 1 70); do
  if ! kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    echo "Local Wrangler terminated" >&2
    tail -50 "$TMP/workerd.log" >&2
    exit 1
  fi
  if curl --max-time 1 --silent --fail \
    "http://127.0.0.1:$PORT/" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "Local workerd did not respond" >&2
  tail -50 "$TMP/workerd.log" >&2
  exit 1
fi

TS52_LOCAL_WORKER_PORT="$PORT" \
  node tests/push01hWorkerdD1.smoke.mjs

echo "PUSH01H_LOCAL_D1_MIGRATIONS=PASS"
echo "PUSH01H_REMOTE_WRITES=NONE"
