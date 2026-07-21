# ADR 0003: Workers bcrypt capability gate

- Date: 2026-07-21
- Status: Pending remote verification
- Decision: No PASS/FAIL decision has been made.

## Context

The Cloud Run password-service design is superseded by a Cloudflare Workers-only bcrypt design.
Before an application Worker uses cost-12 bcrypt, a temporary Worker must prove the actual account
and runtime can hash and verify without leaking passwords, bcrypt hashes, or probe secrets.

## Current state

The local disposable Worker harness validates only cost-12 dummy hashes, accepts only a token-protected
`POST /probe?run=<uuid>` route, and records no secret value in its response or evidence. No Worker was
deployed, no Worker secret was configured, and no remote probe or D1 resource was created for this task.

## Decision gate

Task 2 must record factual remote evidence with exactly 238 requests, semantic bcrypt results, sequential
P95 values, concurrent completion, and Worker Observability results. Only that evidence may establish PASS
or FAIL for this design.
