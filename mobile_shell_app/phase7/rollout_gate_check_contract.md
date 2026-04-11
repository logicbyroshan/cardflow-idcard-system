# Phase 7 Rollout Gate Check Contract

Date: 2026-04-11

## Goal
Automate rollout go/no-go checks so release promotion is repeatable and auditable.

## Command
Use Django management command:

python manage.py mobile_rollout_guard [options]

## Phase Thresholds
1. Crash-free sessions: >= 99.0.
2. ANR rate: <= 0.47.
3. Auth failure rate: <= 2.0x baseline.
4. Upload failure rate: <= 2.0x baseline.
5. Optional stale-device bound: `--max-stale-30d`.

## Example (strict gate)
python manage.py mobile_rollout_guard \
  --crash-free-sessions 99.4 \
  --anr-rate 0.31 \
  --auth-failure-rate 0.8 \
  --auth-failure-baseline 0.5 \
  --upload-failure-rate 1.2 \
  --upload-failure-baseline 0.8 \
  --max-stale-30d 50 \
  --strict

## Output Contract
1. Emits JSON report with:
   - `thresholds`
   - `device_snapshot`
   - `checks`
   - `healthy`
2. In strict mode, exits non-zero when any provided gate fails.

## Notes
1. Metrics not supplied are marked as `skipped` in output.
2. `--include-inactive` includes inactive rows in device snapshot trend checks.
