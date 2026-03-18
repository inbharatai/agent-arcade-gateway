# Contributing to Agent Arcade

Thank you for your interest in Agent Arcade. This document explains how to contribute, how the project is governed, and how you can fork and adapt the project for your own use.

---

## Table of Contents

- [Clone & Customize for Your Own Use](#clone--customize-for-your-own-use)
- [Contributing to This Repository](#contributing-to-this-repository)
- [Development Setup](#development-setup)
- [Branch & Merge Policy](#branch--merge-policy)
- [Code Standards](#code-standards)
- [Opening a Pull Request](#opening-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Clone & Customize for Your Own Use

Agent Arcade is **MIT licensed**. You are free to:

- Clone the repository and run it locally for any purpose
- Fork it and modify it as much as you like for your own projects or products
- Adapt adapters, themes, components, or the gateway for your specific stack
- Self-host it on your own infrastructure

```bash
git clone https://github.com/inbharatai/agent-arcade-gateway.git
cd agent-arcade-gateway
npm install
npm run dev:gateway   # starts the gateway on :47890
npm run dev:web       # starts the UI on :3000
```

No special permission is needed to use or modify this project privately. The MIT license applies.

---

## Contributing to This Repository

If you want your changes merged into the **main repository**, follow this process:

### Step 1 — Fork

Click **Fork** on GitHub and clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/agent-arcade-gateway.git
cd agent-arcade-gateway
git remote add upstream https://github.com/inbharatai/agent-arcade-gateway.git
```

### Step 2 — Branch

Create a focused branch from `main`:

```bash
git checkout -b fix/your-change-description
# or
git checkout -b feat/your-new-feature
```

### Step 3 — Make Changes

Keep changes focused. One concern per PR. If you're adding a new adapter, do not also refactor the gateway in the same PR.

### Step 4 — Test

Run the full CI check locally before opening a PR:

```bash
npm run ci
```

This runs lint, typecheck, build, and all gateway + web tests. All checks must pass.

### Step 5 — Open a Pull Request

Open a PR from your fork's branch to `main` in this repository. Fill in the PR template completely — especially the testing and security checklists.

Your PR will be reviewed by the maintainer. Direct feedback will be left as review comments.

---

## Branch & Merge Policy

| Rule | Detail |
|------|--------|
| **`main` is protected** | No one can push directly to `main` — not even maintainers |
| **All changes require a PR** | Every change, no matter how small, goes through a pull request |
| **Maintainer review required** | At least 1 approving review from `@inbharatai` is required to merge |
| **Stale reviews dismissed** | If you push new commits after approval, the approval is dismissed automatically |
| **No force pushes** | Rewriting public history on `main` is disabled |
| **No branch deletion** | `main` cannot be deleted |
| **CI must pass** | All lint, typecheck, build, and test steps must be green before merge |

This policy keeps the codebase stable and prevents accidental or unauthorized changes to production paths.

---

## Development Setup

### Prerequisites

| Tool | Version | Used by |
|------|---------|---------|
| Node.js | 20+ | Root scripts, web, SDK |
| Bun | latest | Gateway, test runner |
| Docker | any | Docker builds in CI |
| Redis | 7+ | Gateway (optional in dev — in-memory fallback available) |

### Start everything for development

```bash
# Terminal 1 — Gateway
npm run dev:gateway       # Bun, hot-reload, :47890

# Terminal 2 — Web UI
npm run dev:web           # Next.js dev, :3000

# Optional — live telemetry simulation
node scripts/load/human-like-sim.mjs
```

### Run tests

```bash
# Full CI suite
npm run ci

# Gateway integration tests only
bun test packages/gateway/test/gateway.test.ts

# Production hardening tests
bun test packages/gateway/test/production-hardening.test.ts

# Web store tests
cd packages/web && bun test test/store.test.ts

# Adapter tests
bun test packages/adapter-openai/src/index.test.ts
```

### Add a new adapter

1. Copy `packages/adapter-openai/` as a template
2. Implement the same event flow: `spawn → state → tool → message → end`
3. Add your package to the root `package.json` workspaces
4. Add an install step in `.github/workflows/ci.yml`
5. Export from your adapter's `package.json` correctly so consumers can `import`

---

## Code Standards

- **TypeScript strict mode** for all JS/TS packages
- **ESLint** — run `npx eslint src --max-warnings 0` before committing
- **No `any` types** without an explicit justification comment
- **No console.log in production code** — use the gateway's structured logging
- **No hardcoded secrets** — use environment variables
- **Test what you add** — if you add a new gateway endpoint, add a test for it

---

## Opening a Pull Request

Use the PR template (`.github/pull_request_template.md`). At minimum:

- Describe what changed and why
- List how you tested it (commands run, output seen)
- Confirm you've run `npm run ci` and it passed
- Note any breaking changes or security implications

Small, focused PRs are merged faster. If your PR touches `packages/gateway/` or `packages/web/`, it requires CODEOWNERS review.

---

## Reporting Bugs

Use the [Bug Report template](https://github.com/inbharatai/agent-arcade-gateway/issues/new?template=bug_report.md).

Include:
- Agent Arcade version (`agent-arcade version` or package.json)
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs (redact any API keys)

---

## Requesting Features

Use the [Feature Request template](https://github.com/inbharatai/agent-arcade-gateway/issues/new?template=feature_request.md).

Feature requests that align with the project's roadmap and include a clear use case are most likely to be accepted. Complex features may be asked to start as a discussion before a PR.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Be respectful and constructive.

---

*Questions? Open a [Discussion](https://github.com/inbharatai/agent-arcade-gateway/discussions).*
