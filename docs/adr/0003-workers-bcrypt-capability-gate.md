# ADR 0003: Workers bcrypt capability gate

- Date: 2026-07-21
- Status: Rejected by remote capability gate
- Decision: Do not use cost-12 `bcryptjs` password hashing on the Cloudflare Workers Free runtime for this application.

## Context

The Cloud Run password-service design is superseded by a Cloudflare Workers-only bcrypt design.
Before an application Worker uses cost-12 bcrypt, a temporary Worker must prove the actual account
and runtime can hash and verify without leaking passwords, bcrypt hashes, or probe secrets.

## Remote gate evidence

- Temporary Worker: `event-roster-bcrypt-capability`
- Deploy-printed URL: `https://event-roster-bcrypt-capability.event-roster.workers.dev`
- Code deployment version: `a7c9b199-d550-42be-ab52-260175c8af6e`
- Effective version at the remote run: `4210e819-6ee2-4365-aa2d-a9e01d467bc4` (the later Secret-change deployment)
- Evidence: `docs/superpowers/evidence/workers-bcrypt-8f7d857b-8414-48ea-ba1b-cdc5507574f0.json`
- Run ID: `8f7d857b-8414-48ea-ba1b-cdc5507574f0`
- D1 resources created: none

The remote driver recorded exactly 238 attempts. Its status counts were `200: 28`, `404: 5`, and
`503: 205`; therefore the semantic/all-2xx requirement failed. The recorded raw sequential request-time
P95 values (including unsuccessful attempts, so not a semantic-success result) were: hash `638.931 ms`,
correct verify `354.019 ms`, wrong verify `363.160 ms`, and dummy verify `364.116 ms`. The 13-request
concurrent groups had maxima of `2,071.493 ms` (correct verify) and `1,094.770 ms` (hash), but they also
contained non-2xx responses and cannot establish a PASS.

Workers Observability also failed the gate. More than seven minutes after the run and after a dashboard
refresh, the Worker overview showed `227` invocations rather than the expected `238` and `195` errors.
The overview's aggregate CPU Time card showed `10 ms`. Its `195` Errors summary is not an event-by-event
5xx count and is not equated with the client's `503: 205` result. Individual event records could not be
retrieved for all requests; consequently a maximum per-event `cpuTimeMs`, event-level 5xx count,
`exceededCpu` count, and OOM count are unavailable. They are explicitly not treated as zero. This
incomplete Observability data independently fails the gate.

## Decision gate

Task 2 required all 238 remote requests to be semantically successful and all relevant 100%-sampled
Observability events to be available with no 5xx, `exceededCpu`, or OOM outcomes. The actual evidence and
Observability results above fail those criteria. The temporary Worker must be deleted and Tasks 3 onward
must not start under this design.
