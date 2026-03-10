# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/inbharatai/agent-arcade-gateway/releases/tag/v1.0.0
[Unreleased]: https://github.com/inbharatai/agent-arcade-gateway/compare/v1.0.0...HEAD
