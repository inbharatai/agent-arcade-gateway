# @agent-arcade/adapter-anthropic

Auto-instruments Anthropic Claude SDK calls to emit Agent Arcade telemetry. Streaming, tool use, and extended thinking -- all visualized.

## Quick Start

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { wrapAnthropic } from '@agent-arcade/adapter-anthropic'

const client = wrapAnthropic(new Anthropic(), {
  gatewayUrl: 'http://localhost:8787',
  sessionId: 'my-claude-app',
})

// Use normally -- all calls auto-visualized!
const msg = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

## What Gets Tracked

| Claude Feature | Arcade Event |
|---------------|-------------|
| Message create | thinking -> writing -> done |
| Streaming | thinking -> writing (per chunk) -> done |
| Tool use blocks | agent.tool events |
| Extended thinking | thinking state with label |
| Token usage | Tracked in end reason |
| Stop reason | Included in agent.end |

## License

MIT
