# Final Production Readiness Gap Pass (High Risk Only)

This list is intentionally strict and only includes remaining high-risk items after current hardening.

## 1. Redis High Availability is not implemented (single Redis endpoint)
Risk:
- A Redis node outage can remove persistence/rate-limit backing and impact event continuity.

Impact:
- Session continuity degradation and potential ingest/stream instability during Redis outages.

Priority:
- High

Recommended remediation:
- Implement Redis HA topology (managed failover, Sentinel, or Redis Cluster) and validate failover drills.

## 2. Secret rotation workflow is not automated
Risk:
- Long-lived static secrets (`JWT_SECRET`, `SESSION_SIGNING_SECRET`, API keys) increase blast radius if leaked.

Impact:
- Compromise of auth/session trust boundaries.

Priority:
- High

Recommended remediation:
- Add controlled rotation playbooks and automation hooks (dual-key window or staged rollout).

## 3. Formal SLO/alerting policy is missing
Risk:
- Incidents may be detected late without explicit latency/error-budget alerts.

Impact:
- Prolonged user-visible degradation before operator response.

Priority:
- High

Recommended remediation:
- Define SLOs for ingest latency, stream availability, auth failures, and error rates.
- Wire alerting from metrics to on-call channels.

## 4. Disaster recovery validation is not codified
Risk:
- Backups may exist but restore time and correctness are unproven under pressure.

Impact:
- Extended outage or data loss during infra incidents.

Priority:
- High

Recommended remediation:
- Add scheduled backup restore tests and documented RTO/RPO targets.

## 5. End-user identity federation (OIDC/SSO) not implemented
Risk:
- Operational burden and security drift when enterprise identity controls are required.

Impact:
- Blocks enterprise adoption in SSO-mandated environments.

Priority:
- High (for enterprise rollout), Medium (for non-enterprise rollout)

Recommended remediation:
- Add OIDC integration path (issuer discovery, JWKS validation, group/role mapping).

## Exit Criteria
Production can be considered enterprise-ready when:
- Redis HA failover tested and documented.
- Secrets rotate on policy with proven safe rollout.
- SLOs/alerts active and tested.
- DR restore drill passes within agreed RTO/RPO.
- OIDC/SSO available for enterprise tenants.
