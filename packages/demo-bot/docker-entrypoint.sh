#!/bin/sh
# Launch gateway in background, then start demo bot if DEMO_BOT=1

cd /app/gateway

echo "[entrypoint] Starting gateway on port ${PORT}..."
bun src/index.ts &
GATEWAY_PID=$!

if [ "${DEMO_BOT}" = "1" ]; then
  echo "[entrypoint] Waiting 5s for gateway to be ready..."
  sleep 5

  echo "[entrypoint] Starting demo bot..."
  GATEWAY_URL="http://localhost:${PORT}" \
  CYCLE_MS="${CYCLE_MS:-300000}" \
  bun /app/demo-bot/index.ts &
  BOT_PID=$!
fi

# Forward signals to children
trap "kill $GATEWAY_PID $BOT_PID 2>/dev/null; exit 0" TERM INT

# Wait for gateway process
wait $GATEWAY_PID
