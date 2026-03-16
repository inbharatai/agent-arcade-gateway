# Enterprise Step Implemented: Load Testing

This repository now includes a k6 load suite for gateway reliability and capacity baselining.

## Files Added
- `scripts/load/k6-gateway.js`

## What It Tests
- `/health` stability under low constant traffic
- `/v1/ingest` sustained and ramped write load
- `/v1/stream` SSE stream handshake behavior under concurrent clients

## Thresholds
Configured in script:
- `http_req_failed < 1%`
- `http_req_duration p95 < 500ms`
- `http_req_duration p99 < 1200ms`
- Unauthorized rate must remain zero for authenticated runs

## Prerequisites
- Running gateway (`http://localhost:47890` by default)
- Valid auth for authenticated endpoints:
  - `GATEWAY_TOKEN` (JWT) or
  - `GATEWAY_API_KEY`
- Optional `SESSION_SIGNATURE` if session signing is enabled

## Run Locally with Dockerized k6
```bash
docker run --rm -i \
  --network host \
  -e GATEWAY_URL=http://localhost:47890 \
  -e SESSION_ID=load-session \
  -e GATEWAY_TOKEN=<token> \
  -e SESSION_SIGNATURE=<sig> \
  -v "$PWD/scripts/load:/scripts" \
  grafana/k6 run /scripts/k6-gateway.js
```

## Tunable Environment Variables
- `HEALTH_VUS` (default `5`)
- `HEALTH_DURATION` (default `30s`)
- `INGEST_VUS` (default `25`)
- `INGEST_RAMP_UP` (default `30s`)
- `INGEST_HOLD` (default `60s`)
- `INGEST_RAMP_DOWN` (default `20s`)
- `STREAM_VUS` (default `10`)
- `STREAM_DURATION` (default `45s`)
- `STREAM_TIMEOUT` (default `5s`)

## CI/CD Usage Recommendation
- Add a non-blocking nightly load job first.
- Promote to release-gate once baseline stabilizes.
- Keep performance history (p95, p99, failure rate) per commit/tag.

## Interpreting Failures
- 401/403 spikes: auth material not configured for load run.
- High p95 latency: inspect Redis health and rate-limit settings.
- Stream failures: verify proxy/WebSocket/SSE forwarding rules.

## Next Expansion
- Add multi-region latency tests.
- Add long soak profile (15-60 min).
- Add web front-end journey profile (Next.js routes + API health).
