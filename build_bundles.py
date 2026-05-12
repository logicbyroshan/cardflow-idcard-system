#!/usr/bin/env python3
"""
JS & CSS Bundle Builder
=======================
Concatenates and minifies JS/CSS files into page-specific bundles.
Output goes to static/dist/js/ and static/dist/css/.

Usage:
    python build_bundles.py          # Build all bundles (production, minified)
    python build_bundles.py --dev    # Build without minification (faster)
    python build_bundles.py --clean  # Remove dist/ folder

Bundles produced:
    JS:
      - dist/js/core.min.js           (every page)
      - dist/js/idcard-actions.min.js  (idcard-actions page)
      - dist/js/cropper.min.js         (adarsh-cropper page)
      - dist/js/manage-client.min.js   (manage-client page)
      - dist/js/manage-staff.min.js    (manage-staff page)
      - dist/js/group-setting.min.js   (group-setting page)
      - dist/js/dashboard.min.js       (dashboard/index page)
      - dist/js/cardprint.min.js       (print-cards, reprint-cards pages)
    CSS:
      - dist/css/core.min.css          (base styles: fonts + common + global-search)
      - dist/css/idcard-actions.min.css (idcard page styles)
      - dist/css/cropper.min.css       (cropper page styles)
"""

import hashlib
import shutil
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC = BASE_DIR / "static"
DIST_JS = STATIC / "dist" / "js"
DIST_CSS = STATIC / "dist" / "css"

# ─── JS Bundle Definitions ───────────────────────────────────────────────
# Each bundle is (output_name, [list of source files relative to static/])

JS_BUNDLES = [
    # ── Core: loaded on every panel/admin page ──
    (
        "core.min.js",
        [
            "js/core/field-classifier.js",
            "js/core/api.js",
            "js/core/session-keepalive.js",
            "js/core/toast.js",
            "js/core/confirm.js",
            "js/core/modal.js",
            "js/core/utils.js",
            "js/core/sanitizer.js",
            "js/core/confirmation-code.js",
            "js/core/download-manager.js",
            "js/init.js",
            "js/global-search.js",
            "js/notification-bell.js",
        ],
    ),
    # ── IDCard Actions: 20 modules → 1 bundle ──
    (
        "idcard-actions.min.js",
        [
            "js/idcard-actions-core-state.js",
            "js/idcard-actions-core-init.js",
            "js/idcard-actions-table-state.js",
            "js/idcard-actions-table-render-row.js",
            "js/idcard-actions-table-render-main.js",
            "js/idcard-actions-table-load.js",
            "js/idcard-actions-search-filters.js",
            "js/idcard-actions-search-input.js",
            "js/idcard-actions-upload-ui.js",
            "js/idcard-actions-upload-logic.js",
            "js/idcard-actions-download-logic.js",
            "js/idcard-actions-download-modals.js",
            "js/idcard-actions-download-init.js",
            "js/idcard-actions-modal-view-helpers.js",
            "js/idcard-actions-modal-view-render.js",
            "js/idcard-actions-modal-delete.js",
            "js/idcard-actions-modal-form-data.js",
            "js/idcard-actions-modal-form-ops.js",
            "js/idcard-actions-api-status.js",
            "js/idcard-actions-api-bulk.js",
            "js/idcard-actions-crop.js",
            "js/idcard-actions-edit-ui.js",
            "js/idcard-actions-edit-logic.js",
            "js/idcard-actions.js",
        ],
    ),
    # ── Manage Client ──
    (
        "manage-client.min.js",
        [
            "js/manage-client-ui.js",
            "js/manage-client-api.js",
            "js/manage-client-handlers.js",
            "js/manage-client-search.js",
        ],
    ),
    # ── Manage Staff (admin panel) ──
    (
        "manage-staff.min.js",
        [
            "js/manage-staff-state.js",
            "js/manage-staff-drawer.js",
            "js/manage-staff-api.js",
            "js/manage-staff-handlers.js",
            "js/manage-staff-search.js",
        ],
    ),
    # ── Manage Staff Common (client portal) ──
    (
        "manage-staff-common.min.js",
        [
            "js/manage-staff-common-api.js",
            "js/manage-staff-common-drawer.js",
            "js/manage-staff-common-list.js",
            "js/manage-client-staff.js",
        ],
    ),
    # ── Group Setting ──
    (
        "group-setting.min.js",
        [
            "js/group-setting-api.js",
            "js/group-setting-ui.js",
            "js/group-setting-events.js",
        ],
    ),
    # ── Dashboard (index page) ──
    (
        "dashboard.min.js",
        [
            "js/dashboard-ui.js",
            "js/dashboard-actions.js",
        ],
    ),
    # ── Cardprint shared (view helpers used by print-cards & reprint-cards) ──
    (
        "cardprint-shared.min.js",
        [
            "js/idcard-actions-modal-view-helpers.js",
            "js/idcard-actions-modal-view-render.js",
        ],
    ),
]

# ─── CSS Bundle Definitions ──────────────────────────────────────────────

CSS_BUNDLES = [
    # ── Core CSS (loaded on every panel page) ──
    (
        "core.min.css",
        [
            "css/fonts.css",
            "css/common.css",
            "css/global-search.css",
        ],
    ),
    # ── IDCard Actions CSS (all sub-files expanded, no @import) ──
    (
        "idcard-actions.min.css",
        [
            "css/idcard-side-modal.css",
            "css/idcard-action-bar.css",
            "css/idcard-table.css",
            "css/idcard-upload-wizard.css",
            "css/idcard-modals.css",
            "css/client-cards.css",
            "css/idcard-actions-enhanced.css",
            "css/flatpickr-theme.css",
        ],
    ),
    # ── Dashboard CSS (replaces dashboard.css @import chain) ──
    (
        "dashboard.min.css",
        [
            "css/dashboard-layout.css",
            "css/dashboard-stats.css",
            "css/dashboard-table.css",
            "css/dashboard-actions.css",
            "css/dashboard-activity.css",
        ],
    ),
]


def _content_hash(data: bytes) -> str:
    """Return first 8 chars of MD5 for cache verification."""
    return hashlib.md5(data).hexdigest()[:8]


def concat_files(file_list: list[str], base: Path) -> str:
    """Concatenate source files with separator comments."""
    parts = []
    for rel in file_list:
        path = base / rel
        if not path.exists():
            print(f"  WARNING: missing {rel} — skipped")
            continue
        content = path.read_text(encoding="utf-8")
        # Separator for debugging (stripped during minification if comments removed)
        parts.append(f"\n/* ── {rel} ── */\n")
        parts.append(content)
    return "\n".join(parts)


def build_js_bundles(minify: bool = True) -> int:
    """Build all JS bundles. Returns total bytes written."""
    try:
        import rjsmin
    except ImportError:
        print("WARNING: rjsmin not installed — JS will not be minified")
        print("  Install: pip install rjsmin")
        minify = False

    DIST_JS.mkdir(parents=True, exist_ok=True)
    total = 0

    for name, files in JS_BUNDLES:
        raw = concat_files(files, STATIC)
        if minify:
            out = rjsmin.jsmin(raw, keep_bang_comments=False)
        else:
            out = raw
        out_bytes = out.encode("utf-8")
        out_path = DIST_JS / name
        out_path.write_bytes(out_bytes)
        h = _content_hash(out_bytes)
        size_kb = len(out_bytes) / 1024
        total += len(out_bytes)
        print(f"  {name:40s} {size_kb:8.1f} KB  [{h}]  ({len(files)} files)")

    return total


def build_css_bundles(minify: bool = True) -> int:
    """Build all CSS bundles. Returns total bytes written."""
    try:
        import rcssmin
    except ImportError:
        print("WARNING: rcssmin not installed — CSS will not be minified")
        print("  Install: pip install rcssmin")
        minify = False

    DIST_CSS.mkdir(parents=True, exist_ok=True)
    total = 0

    for name, files in CSS_BUNDLES:
        raw = concat_files(files, STATIC)
        if minify:
            out = rcssmin.cssmin(raw)
        else:
            out = raw
        out_bytes = out.encode("utf-8")
        out_path = DIST_CSS / name
        out_path.write_bytes(out_bytes)
        h = _content_hash(out_bytes)
        size_kb = len(out_bytes) / 1024
        total += len(out_bytes)
        print(f"  {name:40s} {size_kb:8.1f} KB  [{h}]  ({len(files)} files)")

    return total


def clean():
    """Remove the dist/ output directories."""
    dist = STATIC / "dist"
    if dist.exists():
        shutil.rmtree(dist)
        print(f"Removed {dist}")
    else:
        print("Nothing to clean.")


def main():
    args = sys.argv[1:]

    if "--clean" in args:
        clean()
        return

    minify = "--dev" not in args
    mode = "production (minified)" if minify else "development (no minification)"

    print(f"\n{'=' * 60}")
    print(f"  Bundle Builder - {mode}")
    print(f"{'=' * 60}\n")

    t0 = time.perf_counter()

    print("JS Bundles:")
    js_total = build_js_bundles(minify)

    print()
    print("CSS Bundles:")
    css_total = build_css_bundles(minify)

    elapsed = time.perf_counter() - t0
    total_kb = (js_total + css_total) / 1024

    print(f"\n{'-' * 60}")
    print(f"  Total: {total_kb:.1f} KB in {elapsed:.2f}s")
    print(f"  Output: static/dist/js/  static/dist/css/")
    print(f"{'-' * 60}\n")


if __name__ == "__main__":
    main()
