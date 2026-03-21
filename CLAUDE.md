# Agent Arcade Gateway — Claude Code Instructions

## OPENCLAW INTEGRATION TRUTH REQUIREMENT

You must audit the OpenClaw adapter against the real OpenClaw ecosystem, not against guessed interfaces. Treat the current OpenClaw integration as unverified until proven otherwise.

Rules:
1. Verify the actual package and SDK surfaces used by OpenClaw.
2. Do not assume any scoped package like `@openclaw/sdk` exists unless it is actually resolvable and documented in the current ecosystem.
3. Use the real OpenClaw package (`openclaw`) and real plugin SDK import surfaces (`openclaw/plugin-sdk/*`).
4. Compare the adapter's assumptions against OpenClaw's actual plugin architecture and event/runtime APIs.
5. If the adapter was written against a guessed duck-typed interface rather than the real SDK, say so clearly.
6. Replace incorrect package names, wrong imports, and imagined interfaces with the real ones.
7. Then test against a real running OpenClaw instance if the repo/environment supports it.
8. If live integration cannot be completed from the current repo/environment, do not claim success. Mark it as unverified and explain the exact blocker.

You must specifically check for:
- wrong peerDependencies
- nonexistent npm package references
- wrong import paths
- fake or assumed event names
- monkey-patching against guessed APIs instead of real plugin hooks
- adapters that are structurally plausible but never actually connected to OpenClaw

For the final report, include an explicit section:

**OPENCLAW ADAPTER VERDICT**
- package name currently used
- correct package name
- current import paths used
- correct import paths
- whether the adapter was connected to a real OpenClaw instance
- whether the integration is real, partial, or only conceptual
- exact fixes made
- exact validation evidence

If the adapter targets a nonexistent package or imagined SDK API, treat that as a false integration claim and fix it before any launch-readiness verdict.
