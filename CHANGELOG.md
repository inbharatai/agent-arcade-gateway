# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2026-03-16

### Added — Phase A: Arcade Console (Natural Language Command Panel)

- **Split Panel Layout** (`components/layout/SplitPanel.tsx`) — Resizable left/right split with draggable divider, localStorage persistence, min 320px console, max 60% viewport. Mobile tab switcher (Arcade | Console). Toggle via Ctrl+` or header button.
- **ArcadeConsole** (`components/ArcadeConsole/`) — Full natural language AI interface alongside the arcade visualization
  - **ModelSelector** — Dropdown with Claude Sonnet 4.6, Claude Opus 4.6, GPT-4o, GPT-4o mini, Gemini 1.5 Pro, Gemini 1.5 Flash, Ollama (local, FREE), with per-model cost display, API key inputs, and connection test buttons
  - **ChatHistory** — Scrollable message thread with streaming typewriter animation, syntax-highlighted code blocks, copy buttons, token/cost metadata per message, and session persistence via localStorage
  - **InputPanel** — Auto-growing textarea with Ctrl+Enter send, Hinglish/Indian language detection indicator, token count + cost estimator, prompt templates dropdown (8 built-in + custom), language normalization
  - **OutputPanel** — Tabbed code/files view: extracts code blocks from AI responses with copy/download, detects referenced file paths
  - **StatsBar** — Live session stats: model name, message count, tokens used, session cost, duration, connected agent count
  - **CommandPalette** — Ctrl+K modal with slash commands: /fix, /explain, /test, /review, /opt, /docs, /refactor, /debug, /ask, /stop, /pause, /status, /cost, /history, /redirect
- **AI Provider Integrations** (`lib/providers/`) — Four streaming providers via direct fetch:
  - `claude.ts` — Anthropic API with SSE streaming, token counting, connection test
  - `openai.ts` — OpenAI chat completions with streaming and usage tracking
  - `gemini.ts` — Google Generative Language API with SSE streaming
  - `ollama.ts` — Local Ollama with model listing (GET /api/tags) and chat streaming
  - `router.ts` — Unified interface: model catalog, cost calculation, provider dispatch
- **Multilingual Input** (`lib/i18n/`) — Client-side language detection and Hinglish normalizer:
  - `detector.ts` — Unicode range detection for 9 Indic scripts + Hinglish pattern matching
  - `normalizer.ts` — 40+ Hinglish phrase replacements (bana do → create, theek karo → fix, etc.), preserves technical terms (React, JWT, API, etc.)
- **Session Store** (`lib/session-store.ts`) — localStorage-backed chat sessions: create, save, list, rename, export to markdown, 50-message cap, 20-session limit
- **Arcade Bridge** (`lib/arcade-bridge.ts`) — Console activity reflected in arcade visualization: console agent spawns, thinking/writing state transitions, code detection, cost updates

### Added — Phase B: Agent Intervention System (Click Any Agent → Full Control)

- **Agent Intervention Hook** (`hooks/useAgentIntervention.ts`) — Per-agent control state, pause/resume/stop/redirect/handoff actions with Socket.IO event emission, confirm dialog pattern for destructive operations
- **ControlPanel** (`components/AgentIntervention/ControlPanel.tsx`) — Click any agent → control panel appears as overlay below the agent. Shows agent state, task, uptime, AI model. Collapsible.
- **Controls** (`components/AgentIntervention/Controls.tsx`) — Pause/Resume/Stop buttons with visual state indicators and pulsing PAUSED badge
- **ActionHistory** (`components/AgentIntervention/ActionHistory.tsx`) — Reverse-chronological timeline of agent actions with type icons, elapsed time, token counts
- **RedirectPanel** (`components/AgentIntervention/RedirectPanel.tsx`) — Mid-task redirect: type new instruction → agent pivots without losing progress. Quick-fill example redirects. Recent redirect history.
- **HandoffPanel** (`components/AgentIntervention/HandoffPanel.tsx`) — Transfer task context from one agent to another with optional note
- **NotificationToast** (`components/AgentIntervention/NotificationToast.tsx`) — Floating bottom-right toasts for agent alerts (warning/success/error/info), auto-dismiss after 6s, click to open control panel. `useNotifications` hook exported.
- **Notifications** (`lib/notifications.ts`) — Helper functions for stuck/done/error/waiting/cost alert notifications

### Added — Phase C: Integration

- Console `/commands` trigger agent intervention (pause, stop, redirect, status)
- ControlPanel wired into main page as overlay above arcade visualization
- Confirm dialogs for destructive operations (stop, handoff)
- `onAgentSelect` callback from AgentArcadePanel wires into intervention system
- `connectedAgents` count fed from arcade store to console StatsBar
- `useArcadeConsole` hook — Ctrl+` keyboard shortcut, arcade bridge initialization
- `useProvider` hook — localStorage persistence for selected model + API keys
- `useLanguage` hook — Debounced language detection for input fields
- Keyboard shortcuts: Ctrl+` (toggle console), Ctrl+K (command palette), Ctrl+Enter (send message)
- Mobile responsive: tab switcher replaces split panel on screens < 768px

### Added — Phase D: Extended Providers & Settings

- **Mistral AI provider** (`lib/providers/mistral.ts`) — mistral-large and mistral-small models with SSE streaming, token counting, and connection test. Integrated into the model router and cost tracking.
- **Settings panel** (`components/Settings/`) — 5-tab settings panel: General, Providers, Appearance, Shortcuts, About. API key management with AES-256 encryption at rest.
- **Voice input** (`components/InputPanel/VoiceInput.tsx`) — Web Speech API integration with language detection, interim results display, and push-to-talk toggle.
- **AES-256 API key encryption** (`lib/crypto.ts`) — Client-side AES-256-GCM encryption for all stored API keys in localStorage.
- **20-language detection engine** — Extended `detector.ts` to support 20 languages across Latin, CJK, Cyrillic, Arabic, and Indic script families.
- **Global translation engine** — Extended `normalizer.ts` with phrase-mapping normalization for Spanish, French, German, Portuguese, Hindi/Hinglish, and other supported languages.
- **Gateway REST agent control endpoints** — New HTTP endpoints at `/v1/agents/:sessionId/:agentId/pause`, `/v1/agents/:sessionId/:agentId/resume`, `/v1/agents/:sessionId/:agentId/stop`, `/v1/agents/:sessionId/:agentId/redirect` for programmatic agent control.
- **100-case language test suite** (`packages/web/test/i18n.test.ts`) — Comprehensive bun test suite covering Indic script detection (hi, bn, ta, te, kn, ml, gu, pa), Hinglish pattern detection, English fallback, Latin-script languages (with TODO markers for full 20-lang detector), Hinglish normalization (action verbs + connectors), and technical term preservation. All tests aligned to current implementation.

### Changed

- **Port assignments** — Gateway runs on `:47890`, web dashboard runs on `:47380` (aligned across all docs and config).
- `app/page.tsx` — Upgraded to v3.2 layout with SplitPanel, ArcadeConsole, ControlPanel overlay, notification toasts
- Version bumped to v3.2.0

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

- Bun runtime for gateway (port 47890)
- Next.js 15 for web visualizer (port 47380)
- Optional Redis for persistence (graceful degradation to in-memory)
- SLSA provenance generation for releases

## [Unreleased]

- Dashboard authentication
- Multi-tenant support
- Historical event replay

[3.2.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.0.0...v3.2.0
[3.0.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/inbharatai/agent-arcade-gateway/releases/tag/v1.0.0
[Unreleased]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.2.0...HEAD
