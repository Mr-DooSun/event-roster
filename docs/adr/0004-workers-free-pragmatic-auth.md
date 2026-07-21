# ADR 0004: Workers Free pragmatic internal authentication

- Date: 2026-07-21
- Status: Accepted with an explicit operational risk
- Decision: Use cost-12 `bcryptjs` only for low-frequency internal authentication, with D1-backed throttling and no automatic retries.

## Context

ADR 0003 records a factual remote failure of the strict bcrypt capability gate. The probe sent 238 requests and recorded only 28 HTTP 200 responses, with 5 HTTP 404 and 205 HTTP 503 responses. Workers Observability was also incomplete. That result remains a FAIL and is not reclassified by this decision.

The application is an internal event-roster tool used by approximately 13 operational staff. Password operations occur during infrequent login, account creation, password reset, and password change flows rather than on ordinary roster requests. The existing ATS project uses the same `bcryptjs` cost-12 approach successfully under its low-frequency operational profile, but it has no equivalent stress-gate evidence.

## Decision

The MVP accepts the possibility that a bcrypt request can fail on Workers Free under sustained or unlucky CPU pressure. It uses:

- canonical English login IDs and cost-12 `bcryptjs` credentials;
- a 15-minute Access JWT kept only in browser memory;
- a seven-day rotating Refresh Token whose plaintext exists only in a `__Host-` HttpOnly cookie;
- D1-backed session revocation, refresh-token replay detection, and login throttling;
- one dummy cost-12 comparison for an unlocked missing or inactive account;
- no automatic retry for login, password hashing, or password verification failures;
- an explicit temporary-unavailable response when an application-level bcrypt error is catchable;
- a low-frequency deployment smoke and manual Workers error/CPU inspection.

The strict high-load gate is not a production prerequisite for this internal MVP. It remains evidence that this architecture is unsuitable if login traffic becomes sustained or externally exposed.

## Consequences

No Cloudflare Access, email OTP, external identity provider, VM, Cloud Run, or paid runtime is introduced. Ordinary API work does not execute bcrypt. D1 rate limits reject locked login-ID/IP keys before bcrypt work.

If low-frequency production smoke or real usage returns Worker 5xx during authentication, operators do not retry automatically. They inspect Workers metrics and revisit the runtime or identity architecture instead of lowering the bcrypt cost.

ADR 0003 and its evidence remain immutable historical records. This ADR changes the product acceptance decision, not the measured result.
