# Phase 6 Rollout Monitoring Plan

Date: 2026-04-11

## Core Metrics
1. Crash-free sessions (target >= 99.0%).
2. ANR rate (target <= 0.47%).
3. Login/auth API error rate (target within 2x baseline).
4. Upload failure rate (target within 2x baseline).
5. Push registration success volume by day.
6. Device heartbeat freshness (stale device count trend).

## Alert Thresholds
1. Crash-free sessions < 99.0% for 2 consecutive hours.
2. ANR rate > 0.47%.
3. Login/auth API failures > 2x baseline for 30+ minutes.
4. Upload failures > 2x baseline for 30+ minutes.

## Staged Rollout Cadence
1. 5% for 4-6 hours.
2. 20% for 24 hours.
3. 50% for 24 hours.
4. 100% after all thresholds remain healthy.

## Halt and Rollback Procedure
1. Halt rollout in Play Console.
2. Triage failing metric source.
3. If rollback required:
   - redeploy prior known-good archived artifact
   - keep latest path unchanged until next approved release
4. Ship hotfix with incremented versionCode.

## Post-Release Verification Window
1. Monitor every hour for first 6 hours.
2. Monitor every 4 hours for next 24 hours.
3. Record final signoff summary in release notes.
