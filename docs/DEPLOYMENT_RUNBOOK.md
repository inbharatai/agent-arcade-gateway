# Deployment Runbook

## Scope
This runbook covers production deployment for Agent Arcade with:
- `gateway` (Bun, Socket.IO + SSE + HTTP ingest)
- `web` (Next.js app)
- Redis for persistence/rate limiting and horizontal fan-out
- TLS termination via Caddy or Nginx

## 1. Secrets and Configuration
Use a secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault). Do not keep production secrets in `.env` checked into git.

### Required secrets
- `JWT_SECRET`: strong random secret for gateway JWT verification and token issuance.
- `SESSION_SIGNING_SECRET`: separate strong random secret for session signature HMAC.
- `GATEWAY_JWT_SECRET`: must match `JWT_SECRET` used by gateway.
- `SESSION_SIGNING_SECRET` in web: must match gateway value.
- Optional `API_KEYS`: static keys for machine clients (`keyId:keyValue:role:sessionRegex`).

### Required non-secret config
- `ALLOWED_ORIGINS`: strict comma-separated allowlist; no wildcard.
- `REDIS_URL`: Redis endpoint used by storage/rate limiter.
- `NEXT_PUBLIC_GATEWAY_URL`: browser-visible gateway URL.
- `REQUIRE_AUTH=1` in production.
- `ENABLE_REDIS_ADAPTER=1` for multi-instance gateway fan-out.

### Secret generation examples
```bash
openssl rand -base64 48
```
Generate separate values for `JWT_SECRET` and `SESSION_SIGNING_SECRET`.

## 2. Redis Requirements
### Baseline
- Redis 7+
- Persistence enabled (`appendonly yes`)
- Network restricted to app subnets / private network
- TLS enabled if crossing untrusted network boundaries

### Memory and retention sizing
Tune based on event volume:
- `MAX_EVENTS` per session
- `RETENTION_SECONDS`

Start with:
- `MAX_EVENTS=500`
- `RETENTION_SECONDS=86400`

### Runtime verification
- `/ready` should return `ready` for healthy Redis-backed mode.
- If gateway is in production and Redis is absent, startup fails by design.

## 3. TLS / Reverse Proxy
Use either:
- `deploy/caddy/Caddyfile`
- `deploy/nginx/nginx.conf`

### Must-have proxy behavior
- Route `/socket.io`, `/v1/*`, `/health`, `/ready`, `/metrics`, `/debug` to gateway.
- Route all other paths to web.
- Forward `X-Forwarded-For`, `X-Forwarded-Proto`, `Host`.
- Preserve WebSocket upgrade headers.
- Enforce HTTPS + HSTS.

## 4. Startup Commands
### Option A: Docker Compose
```bash
docker compose up -d --build
```

### Option B: PM2 on host
```bash
npm ci
cd packages/gateway && bun install
cd ../web && npm ci
cd ../..
npm run build:web
npm run prod:start
```

## 5. Pre-Deploy Checklist
- Secrets loaded from secret manager.
- `ALLOWED_ORIGINS` matches real frontend domain(s).
- TLS certificate installed and valid.
- Redis reachable from gateway.
- `REQUIRE_AUTH=1` confirmed.
- Internal routes policy decided:
  - `ENABLE_INTERNAL_ROUTES=0` unless explicitly needed.

## 6. Smoke Checks (Post Deploy)
Run in order:

### Health and readiness
```bash
curl -sS https://<gateway-domain>/health
curl -sS https://<gateway-domain>/ready
curl -sS https://<web-domain>/api/health
```
Expect:
- `/health`: `{ "status": "ok" }`
- `/ready`: `{ "status": "ready" }` in normal operation
- web `/api/health`: HTTP 200

### Auth-negative checks
```bash
curl -i https://<gateway-domain>/v1/ingest
curl -i https://<gateway-domain>/metrics
```
Expect 401/403 without credentials.

### Token flow check
1. Admin mints session token via `/v1/session-token`.
2. Use token and signature for:
   - `/v1/ingest`
   - `/v1/stream?sessionId=...&sig=...`
3. Confirm event appears in web UI and stream returns state/event payloads.

### WebSocket check
- Browser dev tools should show successful `/socket.io` handshake and steady connection.

## 7. Rollback Procedure
- Keep previous image tags or PM2 release bundle.
- Rollback app first, preserve Redis data.
- Validate `/health`, `/ready`, `/api/health`.
- Replay smoke checks.

## 8. Operational Schedules
- Rotate `JWT_SECRET` and `SESSION_SIGNING_SECRET` on a defined cadence.
- Weekly backup/restore validation for Redis data.
- Monthly dependency patch cycle.
- Quarterly load test baseline and capacity update.

## 9. Incident Quick Commands
```bash
# Compose logs
docker compose logs -f gateway web redis

# PM2 logs
npm run prod:logs

# Check local ports
ss -ltnp | grep -E '47890|3000|6379'
```
