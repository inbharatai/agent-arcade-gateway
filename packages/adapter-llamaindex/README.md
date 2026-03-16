# @agent-arcade/adapter-llamaindex

LlamaIndex adapter for Agent Arcade. Auto-instruments queries, retrievers, synthesis, and embeddings.

## Quick Start

```typescript
import { createLlamaIndexHandler } from '@agent-arcade/adapter-llamaindex'

const handler = createLlamaIndexHandler({
  gatewayUrl: 'http://localhost:47890',
  sessionId: 'my-rag-app',
})

// Use handler callbacks in your LlamaIndex pipeline
handler.onQueryStart('q1', 'What is Agent Arcade?')
// ... retrieval, synthesis, etc.
handler.onQueryEnd('q1', 'Agent Arcade is...')

handler.disconnect()
```

## What Gets Tracked

| LlamaIndex Event | Arcade State |
|-----------------|-------------|
| Query start | thinking |
| Retrieve start | reading + vector_search tool |
| Retrieve end | message with doc count |
| Synthesize start | writing |
| LLM start | thinking |
| LLM stream | writing with token progress |
| Embedding start | reading |
| Error | error state |

## License

MIT
