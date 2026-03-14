# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-15

### Added — Phase 1: Multi-Framework SDK Integrations
- **LangChain adapter** (`@agent-arcade/adapter-langchain`) — BaseCallbackHandler with full lifecycle mapping
- **OpenAI SDK adapter** (`@agent-arcade/adapter-openai`) — Wraps chat, images, audio, embeddings
- **Anthropic/Claude adapter** (`@agent-arcade/adapter-anthropic`) — Streaming, tool use, extended thinking
- **CrewAI adapter** (`agent-arcade-crewai`) — Python adapter for crew/agent/task lifecycle
- **AutoGen adapter** (`agent-arcade-autogen`) — Python adapter for multi-agent conversations
- **LlamaIndex adapter** (`@agent-arcade/adapter-llamaindex`) — Query, retrieval, synthesis, embeddings

### Added — Phase 2: Zero-Code Instrumentation
- **AI Proxy** (`@agent-arcade/proxy`) — HTTP proxy on :8788 that intercepts OpenAI, Anthropic, Gemini, Ollama, Mistral API calls
- **Process Watcher** (`@agent-arcade/watcher`) — Auto-detects AI agent processes (Claude Code, Aider, Cursor, etc.)
- **Git Watcher** (`@agent-arcade/git-watcher`) — Monitors git index and emits file change events
- **Log Tailer** (`@agent-arcade/log-tailer`) — Watches AI tool log files and auto-parses into events
- **Cost Calculator** (`packages/gateway/src/cost.ts`) — Pricing for 25+ models, per-agent cost tracking, budget alerts

### Added — Phase 3: Universal Connector
- **CLI** (`@agent-arcade/cli`) — `agent-arcade init/start/status/demo/hook claude-code`
- **arcade.config.json** — Universal config schema for zero-code setup
- **Claude Code hooks** — Auto-generated pre-tool and post-tool hooks

### Added — Phase 4: Notification System
- **Notification Router** — Central dispatcher for Slack, Discord, Email, WhatsApp
- Alert rules for cost threshold, error rate, agent errors, and agent waiting states
- Rate limiting to prevent notification spam

### Added — Phase 5: Dashboard Upgrades
- **Achievement System** — 30+ achievements across 6 categories (speed, reliability, tooling, endurance, teamwork, special)
- **XP & Leveling** — 12 RPG levels from Novice to Godlike, streak multipliers up to 3.0x
- **Leaderboard** — Sortable rankings across 5 categories with crown icons for top 3
- **Session Replay** — Record/playback/seek/speed control with import/export
- **Cost Dashboard** — Real-time per-agent cost tracking, model breakdown, budget progress bar
- **Achievement Toast** — Animated popup notification on achievement unlock
- **XP Bar** — Animated experience bar with sparkle effects and level-up animations

## [2.1.0] - 2025-07-17

### Security

- **Session signature enforcement** — Gateway now rejects unsigned sessions in production when `SESSION_SIGNING_SECRET` is missing (previously returned `true`, bypassing auth)
- **ReDoS guard on CORS regex** — Origin patterns are validated for length (≤200 chars) and nested quantifiers before `new RegExp()`
- **Input length validation** — Agent names capped at 200 chars, roles at 100, labels at 500, message text at 4000

### Fixed

- **SSE memory leak** — `res.destroy()` now called on write errors in `broadcastSseEvent()` to prevent leaked connections
- **Unbounded messages array** — Messages per agent capped at 1,000 (truncates to last 500)
- **Unbounded tools array** — Tools per agent capped at 500 (truncates to last 250)
- **SDK-node silent failure** — HTTP fallback in `emit()` now retries 2× with exponential backoff instead of `catch(() => {})`
- **SDK-browser silent failure** — Same retry logic applied to browser SDK's HTTP fallback
- **Python SDK silent import failure** — Logs a clear warning when `python-socketio` is not installed instead of silently falling back

### Improved

- **Universal workspace watcher** — `copilot-live.ts` auto-discovers project directories (`backend/`, `frontend/`, `src/`, `packages/`, `app/`, `lib/`) instead of a hardcoded list
- **File classification** — `classifyFile()` uses real project labels (routers, services, components, API, config) instead of generic categories

## [1.0.0] - 2026-03-10

### Added

- **Gateway Server** - Real-time telemetry ingestion via Socket.IO, SSE, and HTTP
- **Web Visualizer** - Next.js dashboard with live event streaming
- **SDK Support**
  - `@agent-arcade/sdk-node` - Node.js/TypeScript SDK
  - `@agent-arcade/sdk-browser` - Browser SDK
  - `agent-arcade` - Python SDK
- **Live Watcher** - Monitor Copilot sessions in real-time (`copilot-live.ts`)
- **Zero-Wiring Mode** - Auto-detect workspace without manual configuration
- **One-Command Start** - `npm run dev:arcade` starts full stack
- **Health Watchdog** - Auto-restart gateway/web if they crash
- **Human-Like Simulator** - Load testing with realistic telemetry patterns
- **Branch Protection** - Required reviews, linear history, admin enforcement
- **Community Files** - CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue templates
- **CI Workflow** - Lint, typecheck, build, test on push/PR

### Infrastructure

- Bun runtime for gateway (port 8787)
- Next.js 15 for web visualizer (port 3000)
- Optional Redis for persistence (graceful degradation to in-memory)
- SLSA provenance generation for releases

## [Unreleased]

- Dashboard authentication
- Multi-tenant support
- Historical event replay
- Prometheus metrics export

[2.1.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/inbharatai/agent-arcade-gateway/releases/tag/v1.0.0
[Unreleased]: https://github.com/inbharatai/agent-arcade-gateway/compare/v2.1.0...HEAD
