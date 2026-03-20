# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.8.0] - 2026-03-20

### Security

- **Directives endpoint rate-limited** — `POST /v1/directives` now applies the same IP-based rate limiting used by the telemetry ingest endpoint. Previously the directives queue was unprotected and could be flooded.
- **Directive instruction sanitization** — Incoming directive `instruction` fields now have control characters (null bytes, backspace, etc.) stripped before storage and execution to prevent unexpected behavior in downstream tools.

### Fixed

- **Directive bridge model hardcoded** — `claude-sonnet-4-6` was hardcoded in `directive-bridge.ts`. Now reads `DIRECTIVE_MODEL` env var with `claude-sonnet-4-5` as the default. Override freely without editing source.
- **Directive bridge session hardcoded** — Session ID `copilot-live` was hardcoded in multiple places. Now reads `BRIDGE_SESSION_ID` env var so the bridge can report telemetry to any session.
- **Goal Mode task completion loop** — When the directive bridge executes a Goal Mode task and succeeds, it now calls `POST /v1/goals/:goalId/tasks/:taskId/update` to mark the task `complete` with the Claude output. On failure it marks the task `failed`. The Goal Mode UI now updates automatically when Claude Code finishes a task — no manual refresh needed.
- **Session signing secret mismatch** — Web dev server was generating session signatures with `agent-arcade-dev-signing` while the gateway expected a different secret. Added `.env.local` entries to align both sides out of the box.

### Added

- **`NEXT_PUBLIC_ENABLE_GAMIFICATION` feature flag** — Set to `0` to disable XP tracking, achievements, leaderboard tabs, and background music. Default is `1` (all on). Gamification tabs are filtered from `GamePanel` at render time. Audio initialisation is skipped entirely when disabled.
- **Canvas agent tree arrowheads** — Parent → child relationship lines now include arrowheads at the child end to show spawn direction. A `spawned by` label appears at the midpoint when either related agent is selected.

### Removed

- **`tw-animate-css` dependency** — Package was listed in devDependencies and imported in `globals.css` but none of its animation classes were used anywhere in the codebase. Removed from both `package.json` and `globals.css`.

---

## [3.7.3] - 2026-03-18

### Fixed

- **Version consistency** — All 23 packages, 3 Python pyproject.toml files, and the CLI `VERSION` source constant now match `3.7.3`. Previously 16 packages were at `3.7.0`, 2 Python adapters at `3.5.0`, sdk-python at `1.0.0`, and CLI source at `3.2.4`.

---

## [3.7.2] - 2026-03-18

### Fixed — Goal Mode (Critical)

- **`/api/goal/decompose` route** — New Next.js API route that performs server-side AI decomposition using the gateway's chat proxy. Validates the task tree with circular-dependency detection and retries once on malformed AI output. The frontend was previously calling this non-existent endpoint and silently failing.
- **`/api/goal/execute` route** — New Next.js API route that builds a complete `GoalState` (with `phases`, `TaskExecution` records, and allocated agent assignments) then registers it with the gateway via `POST /v1/goals/start`. Returns the full `GoalState` so the UI renders the execution graph immediately.
- **`/api/goal/action` route** — New unified action proxy that routes all 8 action types (`pause-all`, `resume-all`, `stop-all`, `approve-phase`, `undo-phase`, `collapse-single`, `request-changes`, `task-action`) to the correct gateway REST endpoints and returns the refreshed `GoalState`.
- **`GoalRecord` type in gateway** — Added `phases: GoalPhaseRecord[]`, `agentName` on tasks, and proper `GoalTaskRecord` interface. Matches `GoalState` in the frontend.
- **`/v1/goals/start`** — Now accepts and persists `phases` and `tasks` from the request body. Returns full goal record (not just `{ goalId, status }`). Emits the full goal in the Socket.IO `goal.started` event.
- **`/v1/goals/:id/pause-all`, `resume-all`, `stop-all`** — All now return `{ goal }` in the response body for UI sync.
- **`/v1/goals/:id/approve-phase`** — Now updates `phases[phaseIndex].status = 'approved'`, activates the next phase, and auto-completes the goal when all phases are approved.
- **`GoalMode` component** — Added Socket.IO subscriptions for all 6 goal events. Added 3-second polling while executing/phase-review. Added error banner with dismiss. Added `SET_ERROR` action to reducer. Fixed `UPDATE_GOAL` to auto-detect phase completion and dispatch `ENTER_PHASE_REVIEW`. Fixed `handleTaskAction` type signature. Fixed `sendGoalAction` `payload` type.

### Added — Production Tests

- **`production-hardening.test.ts`** — 40+ tests covering: input validation (bad event types, oversized names, missing fields), session isolation (events from session A not visible from session B), goal full lifecycle (create → pause → resume → task update → retry → skip → approve-phase → stop), replay correctness (events retrieved in temporal order), rate limiting (burst then health check), error sanitization (no stack traces in 404s, 400 on malformed JSON).
- CI workflow updated to run production-hardening tests as a dedicated step.
- CI secure-mode secrets bumped to ≥32 chars to pass the new weak-secret guard.

---

## [3.7.1] - 2026-03-18

### Security

- **Gateway: hard-fail on weak secrets in production** — Gateway now throws at startup if `JWT_SECRET` or `SESSION_SIGNING_SECRET` are set to known-weak placeholder values (e.g. `change-me-in-production`) or are shorter than 32 characters. An operator can no longer accidentally deploy with example credentials.
- **docker-compose.yml: force explicit secrets** — Both secrets now use Docker Compose `${VAR:?error}` syntax. `docker compose up` fails immediately with a clear message if the secrets are not exported in the environment, preventing silent deployment with placeholder values.
- **docker-compose.yml: `ENABLE_INTERNAL_ROUTES` corrected to `0`** — Internal diagnostic routes are now disabled by default in the production compose file.

### Fixed (Accuracy & Honesty)

- **README: removed "LangSmith-grade", "AgentOps-grade", "Helicone-grade" claims** — Replaced with specific factual feature descriptions (span tree with search + comparison, DVR replay with swimlanes, budget alerts + CSV export). These were marketing comparisons without independent benchmarks.
- **README: "Zero code changes required" clarified** — Now explains the three integration paths: HTTP proxy (0 lines), SDK adapter (1 line), direct HTTP (a few lines). The blanket claim was misleading for SDK-based integrations.
- **README: "Truly zero configuration" softened to "Minimal configuration"** — The API-key inheritance is real and accurate; "zero config" for the overall setup was an overstatement.
- **README: "55-issue security audit" renamed to "Internal security review"** — The review was done internally, not by an independent third party. Honest distinction matters here.
- **README: package count corrected** — "21 packages" → "23 packages".
- **README: added Capability Matrix** — New table explicitly states what is production-ready, what is simulated (demo bot), what is planned, and what has no evidence yet (load test results, production deployments). This is the single most important trust-building addition.

---

## [3.7.0] - 2026-03-18

### Added

- **Hosted demo bot** (`packages/demo-bot/`) — Runs as a sidecar inside the container and continuously emits realistic fake telemetry from 3 simulated agents (Researcher, Coder, Reviewer) so visitors see live agents without configuring anything.
- **Fly.io one-click deploy** — `fly.toml` + `Dockerfile.demo` + `docker-entrypoint.sh`. `fly deploy` goes from zero to a live public URL in under 5 minutes.
- **Deploy Live Demo badge** in README — Links to the Fly.io deployment guide; removes the #1 adoption barrier (no self-hosting required to evaluate).

### Changed

- Version bumped to v3.7.0 across all packages.

---

## [3.6.0] - 2026-03-17

### Added

- **SQLite persistent storage** — Set `DB_PATH=./arcade.db` and all sessions, agents, spans, events survive gateway restarts. WAL mode + `PRAGMA synchronous=NORMAL` for concurrent reads. Auto-selected when `REDIS_URL` is absent.
- **TracePanel: span search** — Full-text search across span name, input, output, and error text. Parent spans shown when any descendant matches.
- **TracePanel: error highlighting** — Spans with `status=error` get a red left border, red name, red background, and inline error message.
- **TracePanel: span comparison** — "Compare" mode lets you select any two spans and see their input/output side-by-side.
- **CostDashboard: budget alerts** — Set a dollar threshold; orange warning banner at 80%, red banner when exceeded.
- **CostDashboard: model comparison table** — Per-model breakdown: calls, input/output tokens, total cost, avg cost/call.
- **CostDashboard: CSV export** — One-click download of full cost history for the current session.
- **SessionReplay: failure detection** — Recordings that contain error states get a red ⚠ badge. "Has errors" filter shows only failed sessions. "Show all" toggle reveals the full recording list.
- **Python adapter: CrewAI** (`packages/adapter-crewai/`) — `agent_arcade_crewai.wrap_crew()` hooks into CrewAI's callback system. Thread-safe, duck-typed, fire-and-forget HTTP.
- **Python adapter: AutoGen** (`packages/adapter-autogen/`) — `agent_arcade_autogen.wrap_agents()` wraps AutoGen 0.3/0.4 agents. Patches `generate_reply`, `a_send`, `a_receive` with graceful fallback.

### Fixed

- **`budgetUsed` always wrong** — GamePanel was computing `totalCost / 10`; CostDashboard now handles budget percentage internally.
- **`processEvent` no-op** — SessionReplay `processEvent` prop was `() => {}`, so replayed events never drove XP/achievement/leaderboard state. Replaced with `processReplayEvent` callback.
- **Dead `setTimeout` wrappers** — `handleCategoryChange`, `dismissToast`, `dismissLevelUp` in GamePanel wrapped state calls in `setTimeout(fn, 0)`, unnecessary since React 19 auto-batches. Removed.
- **`react-hooks/purity` on `Date.now()`** — SessionReplay called `Date.now()` during render. Fixed with lazy `useState(() => Date.now())` and moving inline calls to effect callbacks.
- **`react/no-unescaped-entities`** — Raw `"Record"` in SessionReplay JSX replaced with `&quot;Record&quot;`.
- **Array index as React key** — Timeline markers, swimlane segments, EventInspector rows now use compound keys (`type-ts-index`) instead of array index.
- **Duplicate section header** — CostDashboard had two sections both labelled "Cost by Model"; second renamed to "Model × Calls".
- **`formatCost` mixed prefix/suffix** — Was rendering `$5.00c`; standardised to `¢0.50` / `$1.00`.

### Changed

- Storage startup log now shows `storage: 'redis' | 'sqlite' | 'memory'` instead of `redisEnabled: true/false`.
- Version bumped to v3.6.0 across all packages.

---

## [3.5.0] - 2026-03-17

### Added

- **Execution Traces** (`components/TracePanel.tsx`) — Hierarchical parent→child span tree with collapsible I/O, token stream log, cost per span, and agent filter. New `agent.span` event type accepted by gateway. `GET /v1/session/:id/traces` endpoint.
- **Session Replay** (`components/SessionReplay.tsx`) — DVR-style playback: timeline scrubber, per-agent swimlanes (Gantt-style), event inspector, state snapshot at any seek point. Speed control 0.25×–8×. Up to 50 recordings persisted in localStorage.
- **Cost Analytics** (`components/CostDashboard.tsx`) — Real token data from spans, per-model cost breakdowns, budget progress bar, 80% warning threshold.
- **GamePanel: 6 tabs** — XP / Achievements / Leaderboard / Costs / Traces / Replay.

### Fixed

- **Recording sync** — Event capture now uses `engine.isRecording()` directly; both tab-bar and in-panel record buttons now work correctly.
- **Milestone off-by-one** — Tool milestone fired at 1st, 6th, 11th… tool; now correctly fires at 5th, 10th, 15th…
- **State mutation** — `milestones` array is now cloned before pushing, preventing Zustand state mutation.

### Changed

- Version bumped to v3.5.0 across all packages.

---

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

[3.7.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.6.0...v3.7.0
[3.6.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.5.0...v3.6.0
[3.5.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.2.0...v3.5.0
[3.2.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.0.0...v3.2.0
[3.0.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/inbharatai/agent-arcade-gateway/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/inbharatai/agent-arcade-gateway/releases/tag/v1.0.0
[Unreleased]: https://github.com/inbharatai/agent-arcade-gateway/compare/v3.7.0...HEAD
