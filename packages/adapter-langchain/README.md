# @agent-arcade/adapter-langchain

Auto-instruments LangChain applications to emit Agent Arcade telemetry. One line of code to visualize your chains, tools, and retrievers in the pixel-art dashboard.

## Quick Start

```typescript
import { createArcadeCallback } from '@agent-arcade/adapter-langchain'

const cb = createArcadeCallback({
  gatewayUrl: 'http://localhost:8787',
  sessionId: 'my-langchain-app',
})

const result = await chain.invoke(
  { input: 'Hello!' },
  { callbacks: [cb] }
)

cb.disconnect()
```

## What Gets Tracked

| LangChain Event | Arcade Event | State |
|----------------|-------------|-------|
| LLM Start | agent.spawn + agent.state | thinking |
| LLM New Token | agent.state | writing |
| LLM End | agent.end | done |
| Chain Start | agent.spawn | thinking |
| Tool Start | agent.tool + agent.state | tool |
| Retriever Start | agent.state + agent.tool | reading |
| Agent Action | agent.tool | tool |
| Error | agent.state | error |

## License

MIT
