# @agent-arcade/adapter-openai

Auto-instruments OpenAI SDK calls to emit Agent Arcade telemetry. Wrap your client once -- every API call is visualized.

## Quick Start

```typescript
import OpenAI from 'openai'
import { wrapOpenAI } from '@agent-arcade/adapter-openai'

const client = wrapOpenAI(new OpenAI(), {
  gatewayUrl: 'http://localhost:47890',
  sessionId: 'my-openai-app',
})

// Use normally -- all calls auto-visualized!
const res = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

## What Gets Tracked

| OpenAI Method | Arcade State Flow |
|--------------|-------------------|
| chat.completions.create | thinking -> writing -> done |
| chat.completions.create (stream) | thinking -> writing (per chunk) -> done |
| images.generate | tool (dall-e) -> done |
| audio.transcriptions.create | reading -> done |
| audio.speech.create | writing -> done |
| embeddings.create | reading -> done |

## License

MIT
