# Phase 8 Release Preflight Contract

## Objective
Provide one final executable gate before production promotion so release decisions are deterministic and repeatable.

## Command
`python manage.py mobile_release_preflight`

## Validation Coverage
1. Build ordering is valid (`latest_build >= min_supported_build`).
2. Latest version and update URL are present.
3. Support URL is present (warn-level when missing).
4. Update URL resolution behavior:
   - Remote URL (`http/https`) is accepted.
   - Local URL path can be validated with `--require-local-apk`.
5. Config payload preview is emitted for both latest and legacy app build contexts.

## Strict Mode
Use strict blocking mode for production promotion:
`python manage.py mobile_release_preflight --strict --require-local-apk`

If any fail-level gate is violated, strict mode exits non-zero.

## Evidence
Store JSON output from this command with rollout guard output for release signoff notes.
