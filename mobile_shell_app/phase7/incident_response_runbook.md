# Phase 7 Incident Response Runbook

Date: 2026-04-11

## Trigger Conditions
1. `mobile_rollout_guard --strict` fails.
2. Play Console crash-free sessions below 99.0.
3. Play Console ANR rate above 0.47.
4. Auth/upload failure rates exceed 2x baseline.

## Immediate Actions
1. Freeze rollout percentage increase in Play Console.
2. Capture failing metric snapshots in release notes.
3. Notify engineering and operations owners.

## Triage Steps
1. Confirm whether failures are global or build-specific.
2. Compare top active builds via `device_snapshot.top_builds`.
3. Validate auth and upload API health using backend logs.
4. Confirm stale device trend and heartbeat freshness.

## Rollback Decision
1. If P0/P1 regression persists >30 minutes, halt rollout.
2. Restore prior known-good archive artifact.
3. Keep latest policy path unchanged until a hotfix is approved.

## Hotfix Exit Criteria
1. Guard command returns healthy in strict mode.
2. Real-device smoke checklist passes.
3. 4-6 hour canary remains stable before promotion.
