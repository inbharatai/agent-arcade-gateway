# @agent-arcade/proxy

Zero-code AI API proxy that auto-emits Agent Arcade telemetry. Just change your base URL -- no SDK needed.

## Quick Start

```bash
# Start the proxy
bun run packages/proxy/src/index.ts

# Use with OpenAI
OPENAI_BASE_URL=http://localhost:8788/openai python my_app.py

# Use with Anthropic
ANTHROPIC_BASE_URL=http://localhost:8788/anthropic node my_app.js

# Use with Ollama
OLLAMA_HOST=http://localhost:8788/ollama ollama run llama3
```

## Supported Providers

| Provider | Proxy Path | Target |
|----------|-----------|--------|
| OpenAI | /openai/* | api.openai.com |
| Anthropic | /anthropic/* | api.anthropic.com |
| Google Gemini | /gemini/* | generativelanguage.googleapis.com |
| Ollama | /ollama/* | localhost:11434 |
| Mistral | /mistral/* | api.mistral.ai |

## What Gets Tracked

- Model name and provider
- Token usage (input/output)
- Latency per request
- Streaming vs non-streaming
- Errors with messages

## License

MIT
