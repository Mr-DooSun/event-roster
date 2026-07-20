# ADR 0001: Workers Free capability gate

- Date: 2026-07-20
- Status: Rejected
- Decision: FAIL — do not start the Worker MVP implementation on Workers Free

## Context

The Worker MVP requires all of the following on the actual Workers Free account:

- PBKDF2-HMAC-SHA-256 with a fixed 600,000 iterations for correct, wrong, and nonexistent-user password paths;
- password-path CPU P95 at or below 6 ms and no `exceededCpu` outcomes;
- JWT verification and password-change revocation of two sessions;
- one atomic 392-statement D1 batch and complete rollback on failure;
- a gzip upload below 3 MiB.

Local emulation is insufficient for this gate. The decision uses remote evidence from the deployed Worker and Cloudflare Workers Observability.

## Remote evidence

- Worker URL: `https://event-roster-capability.event-roster.workers.dev`
- Base deploy version: `37074eae-0067-4cf4-a2ab-d166362ba04b`
- Executed secret-change script version: `f5e5d35c-c94f-4d73-a715-3fb38afd1f69`
- Gate run ID: `e55f8b42-0e96-4c91-b8e2-c5cf6c115a88`
- Evidence: `docs/superpowers/evidence/e55f8b42-0e96-4c91-b8e2-c5cf6c115a88.json`
- Upload: 76.66 KiB total / 18.78 KiB gzip

| Capability | Remote result | Gate result |
| --- | --- | --- |
| Correct password, 50 sequential requests | 50 × HTTP 500 | FAIL |
| Wrong password, 50 sequential requests | 50 × HTTP 500 | FAIL |
| Nonexistent user, 50 sequential requests | 50 × HTTP 500 | FAIL |
| Correct password, 13 concurrent requests | 10 × HTTP 500, 3 × HTTP 404 during secret propagation | FAIL |
| JWT issue/verify and two-session password-change revocation | HTTP 200; all proof flags true | PASS |
| Atomic D1 import | HTTP 200; 392 committed rows | PASS |
| D1 rollback | HTTP 200; 0 residual rows | PASS |
| Bundle size | 18.78 KiB gzip | PASS |

Workers Observability, filtered by the run's unique script version and request scenario, reported `$workers.cpuTimeMs` P95 values of 5 ms for `correct`, 1 ms for `wrong`, and 1 ms for `nonexistent`. It reported 0 events with `$workers.outcome = "exceededCpu"`.

Those low CPU values do not prove that the required KDF fits Workers Free: the 600,000-iteration PBKDF2 operation was rejected before derivation completed. Observability recorded 160 `NotSupportedError` events for the script version. One correlated invocation (`requestId` `a1e1ef816f2b9dea`) was HTTP 500 with 0 ms CPU and 2 ms wall time; the application error event contained `runId=e55f8b42-0e96-4c91-b8e2-c5cf6c115a88`, `scenario=correct`, and `error=NotSupportedError`.

Cloudflare documents PBKDF2 as a supported Workers Web Crypto algorithm, but workerd's public implementation also has an embedder-configurable PBKDF2 iteration limit and rejects values above it with `NotSupportedError`. The workerd change that introduced the limit states that its unconfigured default remains 100,000 iterations. The deployed runtime's observed rejection at the required 600,000 iterations is the decisive evidence.

Primary sources:

- [Cloudflare Workers Web Crypto supported algorithms](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [workerd PR #1471: configurable PBKDF2 iteration limit](https://github.com/cloudflare/workerd/pull/1471)

## Decision

The Workers Free capability gate is **FAIL**. The required 600,000-iteration password KDF cannot execute in the deployed runtime, so successful password semantics and meaningful KDF CPU P95 cannot be demonstrated. Passing JWT, D1, bundle-size, and non-exceeded-CPU checks cannot compensate for the failed password capability.

Task 2 must not start. A future architecture decision must change the hosting tier/runtime or explicitly revise the password-KDF requirement before implementation resumes.
