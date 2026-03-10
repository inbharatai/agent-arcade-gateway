# Agent Arcade

A production-ready telemetry gateway and visualizer for multi-agent workflows.

Agent Arcade turns raw agent events into a real-time operational view: who is active, what tools are being used, where work is blocked, and how sessions progress over time.

## Visual Hero

[![Repository](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/inbharatai/agent-arcade-gateway)
[![Open Issues](https://img.shields.io/github/issues/inbharatai/agent-arcade-gateway)](https://github.com/inbharatai/agent-arcade-gateway/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/inbharatai/agent-arcade-gateway)](https://github.com/inbharatai/agent-arcade-gateway/pulls)
[![Security](https://img.shields.io/badge/Security-Policy-blue)](https://github.com/inbharatai/agent-arcade-gateway/blob/main/SECURITY.md)
[![Contributing](https://img.shields.io/badge/Contributing-Guide-success)](https://github.com/inbharatai/agent-arcade-gateway/blob/main/CONTRIBUTING.md)

[![Agent Arcade Screenshot](docs/assets/hero-screenshot.png)](https://github.com/inbharatai/agent-arcade-gateway)

[![Agent Arcade Demo GIF](docs/assets/hero-demo.gif)](https://github.com/inbharatai/agent-arcade-gateway)

Live links:

- Repository: https://github.com/inbharatai/agent-arcade-gateway
- Issues: https://github.com/inbharatai/agent-arcade-gateway/issues
- Pull requests: https://github.com/inbharatai/agent-arcade-gateway/pulls
- Actions: https://github.com/inbharatai/agent-arcade-gateway/actions
- Security tab: https://github.com/inbharatai/agent-arcade-gateway/security

## Why Agent Arcade

Most agent systems expose logs. Agent Arcade exposes behavior.

- Live, session-scoped visualization of agent activity
- Multi-transport ingestion: HTTP, WebSocket, SSE
- Replay support for timeline reconstruction
- Security controls for auth, signing, CORS, and rate limits
- SDKs for Node.js, browser, and Python
- Deployable with Docker Compose or PM2

## What You Get

- Gateway service (`packages/gateway`) on port `8787`
- Next.js visualizer (`packages/web`) on port `3000`
- SDKs:
  - `packages/sdk-node`
  - `packages/sdk-browser`
  - `packages/sdk-python`
- Load and simulation scripts in `scripts/load`
- Deployment assets (`docker-compose.yml`, Dockerfiles, nginx/caddy examples)

## Architecture

```mermaid
flowchart LR
  A[Agents via SDKs] -->|POST /v1/ingest| G[Gateway :8787]
  W[File/Process Emitters] -->|POST /v1/ingest| G
  G -->|SSE /v1/stream| UI[Web Visualizer :3000]
  G <-->|Socket.IO /socket.io| UI
  G -->|health and capabilities| Ops[Operators/Automation]
  R[(Redis optional)] <--> G
```

## Feature Highlights

### Real-time state model

Track agents through states like:

- `idle`
- `thinking`
- `reading`
- `writing`
- `tool`
- `waiting`
- `done`

### Session telemetry

- Per-session stream and replay
- Agent-level progress and labels
- Message and tool events
- Parent-child links between agents
- Position events for layout and scene rendering

### Operational safeguards

- JWT-based auth in secure mode
- Session signatures for trusted client session access
- CORS allowlist controls
- Flood and payload-size controls
- Health and readiness endpoints

## Quick Start (Local)

### Requirements

- Node.js 20+
- npm 10+
- Bun 1.3+

### 1) Install dependencies

```powershell
# from repo root
npm ci
cd packages/gateway; bun install
cd ../web; npm ci
cd ../..
```

### 2) Run gateway and web

```powershell
# terminal 1
npm run dev:gateway

# terminal 2
npm run dev:web
```

### 3) Open app

- Web: `http://localhost:3000`
- Gateway health: `http://localhost:8787/health`
- Gateway capabilities: `http://localhost:8787/v1/capabilities`

### 4) Generate realistic activity

```powershell
node scripts/load/human-like-sim.mjs
```

## SDK Quickstart Examples

### Node.js SDK

```ts
import { AgentArcade } from '@agent-arcade/sdk-node'

const arcade = new AgentArcade({
  url: 'http://localhost:8787',
  sessionId: 'node-demo-session',
})

const agentId = arcade.spawn({ name: 'Node Coder', role: 'assistant' })
arcade.state(agentId, 'thinking', { label: 'Planning implementation', progress: 0.2 })
arcade.tool(agentId, 'read_file', { path: 'src/index.ts', label: 'Reading source' })
arcade.state(agentId, 'writing', { label: 'Writing feature', progress: 0.7 })
arcade.message(agentId, 'Implementation complete, running checks')
arcade.end(agentId, { reason: 'Task complete', success: true })
arcade.disconnect()
```

### Browser SDK (ES Module)

```ts
import { AgentArcadeBrowser } from '@agent-arcade/sdk-browser'

const arcade = AgentArcadeBrowser.init({
  url: 'http://localhost:8787',
  sessionId: 'browser-demo-session',
})

const agentId = arcade.spawn({ name: 'Frontend Agent', role: 'assistant' })
arcade.state(agentId, 'thinking', { label: 'Preparing UI update', progress: 0.3 })
arcade.tool(agentId, 'open_browser', { label: 'Previewing page' })
arcade.state(agentId, 'writing', { label: 'Updating components', progress: 0.85 })
arcade.end(agentId, { reason: 'UI changes applied', success: true })
```

### Browser SDK (Script Tag)

```html
<script src="https://unpkg.com/@agent-arcade/sdk-browser/dist/index.js"></script>
<script>
  const arcade = window.AgentArcade.init({
    url: 'http://localhost:8787',
    sessionId: 'browser-global-demo',
  })

  const id = arcade.spawn({ name: 'Browser Bot' })
  arcade.state(id, 'thinking', { label: 'Analyzing page' })
  arcade.end(id, { reason: 'Done' })
</script>
```

### Python SDK

```python
from agent_arcade import AgentArcade

arcade = AgentArcade(url="http://localhost:8787", session_id="python-demo-session")

agent_id = arcade.spawn(name="Python Planner", role="assistant")
arcade.state(agent_id, "thinking", label="Reviewing requirements", progress=0.25)
arcade.tool(agent_id, "read_file", path="docs/spec.md", label="Reading spec")
arcade.state(agent_id, "writing", label="Drafting solution", progress=0.8)
arcade.message(agent_id, "Submitting final plan")
arcade.end(agent_id, reason="Completed", success=True)
arcade.disconnect()
```

## Protocol Snapshot

Example ingest payload:

```json
{
  "sessionId": "copilot-live",
  "agentId": "copilot-main",
  "type": "agent.state",
  "ts": 1773120000000,
  "payload": {
    "state": "writing",
    "label": "Drafting response",
    "progress": 0.62,
    "source": "process",
    "confidence": 0.96
  }
}
```

Supported event families include:

- `agent.spawn`
- `agent.state`
- `agent.tool`
- `agent.message`
- `agent.link`
- `agent.position`
- `agent.end`
- `session.start`
- `session.end`

## API Endpoints

Gateway (`:8787`):

- `POST /v1/ingest`
- `GET /v1/stream?sessionId=...`
- `GET /v1/connect?sessionId=...`
- `GET /v1/capabilities`
- `GET /health`
- `GET /ready`

Web (`:3000`):

- `GET /api/health`
- `POST /api/session-token`

## Quality Gates

Run full local checks:

```powershell
npm run ci
```

This includes linting, typecheck, build, and automated tests for gateway/web/SDK packages.

## Production Deployment

### Docker Compose

```powershell
docker compose up -d --build
```

Set real secrets before exposing publicly:

- `JWT_SECRET`
- `SESSION_SIGNING_SECRET`
- `GATEWAY_JWT_SECRET`

Important:

- `GATEWAY_JWT_SECRET` in web must match gateway JWT secret.
- Keep session signing secret consistent between issuer and validator.

### PM2 (VM/Bare metal)

```powershell
npm run build:web
npm run prod:start
npm run prod:status
```

## Security Posture

Recommended for production:

- Enable auth (`REQUIRE_AUTH=1`)
- Use strong random secrets (32+ bytes)
- Restrict `ALLOWED_ORIGINS`
- Enable HTTPS at edge proxy (nginx/caddy)
- Keep branch protection enabled on `main`
- Require pull requests and approvals for changes

See:

- `SECURITY.md`
- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/PROD_READINESS_GAPS.md`

## Monorepo Map

- `packages/gateway`: Bun HTTP + Socket.IO + SSE telemetry gateway
- `packages/web`: Next.js visualizer and UI runtime
- `packages/sdk-node`: Node client SDK
- `packages/sdk-browser`: Browser client SDK
- `packages/sdk-python`: Python package scaffold
- `scripts/load`: load generation and simulation tools
- `docs`: runbooks, readiness notes, and integration guides

## Contributing

Contributions are welcome.

1. Fork repository
2. Create feature branch
3. Run `npm run ci`
4. Open pull request with clear scope and test evidence

See `CONTRIBUTING.md` for full guidance.

## License

MIT License. See `LICENSE`.

## Maintainer Note

This repository is designed for operator trust:

- clear event contracts
- observable runtime behavior
- explicit security controls
- deployment paths that work from local to production
