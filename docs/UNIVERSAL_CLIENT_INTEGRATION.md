# Universal Client Integration

Agent Arcade Gateway supports any client that can send HTTP/WebSocket events: Cursor-like tools, browser apps/extensions, desktop apps, and custom agent runtimes.

## 1. Discover Gateway Capabilities

Query:

```bash
curl http://localhost:8787/v1/capabilities
```

Response includes:
- `transports.ingestHttp`: HTTP ingest route
- `transports.streamSse`: SSE stream route
- `transports.connectHttp`: handshake route for connection announcements
- `transports.socketIoPath`: Socket.IO path
- `auth.required` and `auth.modes`
- CORS config

## 1.5 Announce AI + Agent Mapping on Connect

Call this once when your client connects to make Arcade immediately show:
- which client connected
- which AI model is used
- which agent maps to which model/task

```bash
curl -X POST http://localhost:8787/v1/connect \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "copilot-live",
    "sig": "<session-signature>",
    "meta": {
      "clientName": "Cursor Browser Plugin",
      "aiModel": "GPT-5.3-Codex",
      "agentMap": {
        "planner": "GPT-5.3-Codex",
        "coder": "GPT-5.3-Codex",
        "terminal": "Command Runner"
      },
      "taskMap": {
        "planner": "task decomposition",
        "coder": "file edits and patches",
        "terminal": "run/tests/build"
      }
    }
  }'
```

Socket clients can also include these fields directly in `subscribe` payload.

## 2. Minimal HTTP Ingest (works from any client)

```bash
curl -X POST http://localhost:8787/v1/ingest \
  -H "Content-Type: application/json" \
  -H "X-Session-Signature: <signature>" \
  -d '{
    "v": 1,
    "ts": 1741511111000,
    "sessionId": "copilot-live",
    "agentId": "client-agent-1",
    "type": "agent.message",
    "payload": { "text": "Hello from external client", "level": "info" }
  }'
```

## 3. Browser Client Example (Fetch)

```javascript
async function emitEvent(gatewayUrl, sessionId, sessionSignature, ev) {
  const body = {
    v: 1,
    ts: Date.now(),
    sessionId,
    ...ev,
  };

  const res = await fetch(`${gatewayUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Signature': sessionSignature,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await res.text());
}
```

## 4. Any-Browser Dev Mode (Plug-and-Play)

Default development behavior now allows any browser origin:
- `ALLOWED_ORIGINS=*` (implicit in dev if not set)
- auth can be disabled for local testing (`REQUIRE_AUTH=0`)

For production, set a strict allowlist:

```env
ALLOWED_ORIGINS=https://yourapp.com,https://app.yourclient.com
REQUIRE_AUTH=1
JWT_SECRET=<strong-secret>
SESSION_SIGNING_SECRET=<strong-secret>
```

## 5. Cursor / Copilot / Custom App Mapping

Map client actions to event types:
- file read/search -> `agent.state` (`reading`) + `agent.tool` (`read_file`/`grep_search`)
- code edit -> `agent.state` (`writing`) + `agent.tool` (`edit_file`)
- run command -> `agent.state` (`tool`) + `agent.tool` (`run_command`)
- final response -> `agent.message`
- completion -> `agent.end`

This keeps visual behavior consistent regardless of source client.
