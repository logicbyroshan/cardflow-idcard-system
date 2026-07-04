# Testing Lanes (Pytest)

This repository now supports marker-based test lanes so local and CI runs can trade off speed vs depth.

## Why this exists

Full suite runtime is high (latest profiling: 810 tests in ~61 minutes), and most of that runtime is concentrated in mobile and export-heavy integration coverage.

## Prerequisites

Use the project venv and install dev deps:

```bash
pip install -r requirements-dev.txt
```

## Lane Definitions

### 1) Fast lane (default local loop)

Use this while coding most features.

```bash
python -m pytest -m "not slow and not very_slow" --reuse-db -q
```

### 2) Important lane (PR/blocker checks)

Covers business-critical regressions tagged `important` (security, office-work, reprint, key integration paths).

```bash
python -m pytest -m "important and not very_slow" --reuse-db -q
```

### 3) Slow lane (integration-heavy)

Mainly mobile_app and exports coverage.

```bash
python -m pytest -m "slow and not very_slow" --reuse-db -q
```

### 4) Very slow lane (nightly/release)

Includes expensive smoke + visual baseline matrix checks.

```bash
python -m pytest -m "very_slow" --reuse-db -q
```

### 5) Full release lane

Run this before production release and after major refactors.

```bash
python -m pytest --reuse-db --durations=80 --durations-min=0.5 -q
```

## Current Marker Rules

Markers are auto-applied in root `conftest.py` so existing tests did not need file-by-file edits.

- `slow`: currently applied to `mobile_app/tests.py` and `exports/tests.py`
- `very_slow`: currently applied to `mobile_app/tests.py::MobileAppPhase1SmokeAndVisualTests::*`
- `important`: key security + office-work + reprint + integration class patterns

Adjust these rules in `conftest.py` as test distribution evolves.

## What to optimize next (instead of deleting coverage)

These are better first steps than removing tests:

1. Move repeated fixture-heavy setup from `setUp` to `setUpTestData` in large classes.
2. Parameterize repetitive API matrix tests to reduce repeated DB/bootstrap overhead.
3. Keep one end-to-end smoke per workflow, move exhaustive variants to lower-level service tests.
4. Use `--reuse-db` by default in local runs.
5. Optionally add xdist (`-n auto`) on multi-core CI runners.

## Candidate consolidation hotspots

From latest duration profile, biggest runtime concentration is in:

- `mobile_app/tests.py::MobileAppManagementApiTests`
- `mobile_app/tests.py::MobileAppCardApiTests`
- `mobile_app/tests.py::MobileAppCoverageGapRegressionTests`
- `client/tests.py::ManageClientsPaginationTests`

Consolidate repetitive variants there first.
