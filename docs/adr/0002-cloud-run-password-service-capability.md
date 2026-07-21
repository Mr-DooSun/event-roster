# ADR 0002: Cloud Run password-service capability gate

- Date: 2026-07-21
- Status: Pending remote verification
- Decision: No PASS/FAIL decision has been made

## Context

The replacement architecture moves Argon2id password hashing and verification to a minimal
FastAPI service on Cloud Run. A temporary token-protected Cloudflare Worker must prove the real
Worker-to-Cloud-Run path before any application task consumes this architecture.

The gate requires factual remote evidence for signed raw-body requests, correct and incorrect
password semantics, missing-PHC dummy verification, rejection of a corrupted signature, 13
concurrent correct verifications within the eight-second client timeout, and warm-scenario P95 at
or below 1,500 milliseconds.

## Current state

The local service, temporary Worker harness, remote probe driver, and strict evidence validator are
implemented and locally tested. No Cloud Run service, Google Secret Manager secret, Cloudflare
Worker, remote probe run, or capability evidence was created as part of this local implementation
commit.

## Decision gate

This ADR intentionally records no capability result. After an operator performs the approved
remote gate, this document may be updated with the exact Cloud Run revision and limits, Worker URL,
evidence path, measured P95 values, and a factual PASS or FAIL decision. Task 2 and later remain
blocked until that remote result is PASS.
