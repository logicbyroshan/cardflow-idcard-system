# -*- mode: python ; coding: utf-8 -*-
"""
passport_engine.spec
────────────────────
PyInstaller spec for building AdarshCropper.exe (Adarsh Engine)

Build command:
    pyinstaller passport_engine.spec

Output:
    dist/AdarshCropper.exe   (single-file, no console)

Prerequisites:
    pip install pyinstaller
"""

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# ── Paths ────────────────────────────────────────────────────────────────
PROJECT_DIR = os.path.abspath(SPECPATH)
MODELS_DIR = os.path.join(PROJECT_DIR, "models")

# ── Hidden imports ───────────────────────────────────────────────────────
# MediaPipe ships native libs + protobuf descriptors that PyInstaller
# can't auto-discover.  We also need all uvicorn sub-modules since it
# lazy-loads protocol implementations.
hiddenimports = (
    collect_submodules("mediapipe")
    + collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("pydantic")
    + collect_submodules("starlette")
    + [
        "passport_engine_core",
        "passport_engine_core.config",
        "passport_engine_core.engine",
        "passport_engine_core.extractor",
        "passport_engine_core.processor",
        "passport_engine_core.page_photo_picker",
        "passport_engine_core.renamer",
        "passport_engine_core.adjustments",
        "passport_engine_core.validators",
        "multipart",
        "PIL",
        "numpy",
        "psutil",
    ]
)

# ── Data files ───────────────────────────────────────────────────────────
# ML models must ship next to the exe (or be bundled inside).
# We also bundle mediapipe's own data files (TFLite GPU delegates, etc.).
datas = [
    # Our ML models → models/ at runtime
    (MODELS_DIR, "models"),
    # VERSION.txt at root
    (os.path.join(PROJECT_DIR, "VERSION.txt"), "."),
    # passport_engine_core package (source)
    (os.path.join(PROJECT_DIR, "passport_engine_core"), "passport_engine_core"),
]

# Add mediapipe data files (protobuf descriptors, TFLite delegates, etc.)
datas += collect_data_files("mediapipe")

# ── Native binaries ─────────────────────────────────────────────────────
# MediaPipe loads libmediapipe.dll via importlib.resources at runtime.
# collect_data_files does NOT include .dll/.so files, so we must use
# collect_dynamic_libs to bundle the native shared library.
binaries = collect_dynamic_libs("mediapipe")

# ── Analysis ─────────────────────────────────────────────────────────────
a = Analysis(
    [os.path.join(PROJECT_DIR, "main.py")],
    pathex=[PROJECT_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "scipy",
        "pandas",
        "IPython",
        "notebook",
        "pytest",
        "django",
    ],
    noarchive=False,
)

# ── PYZ (Python bytecode archive) ────────────────────────────────────────
pyz = PYZ(a.pure)

# ── EXE ──────────────────────────────────────────────────────────────────
# ── Version Info (embedded in the EXE → shows in Properties → Details) ───────
# This makes the EXE look legitimate to Windows Defender / SmartScreen.
# The version string "2.2.0.0" is auto-stamped by CI from the git tag.
version_file   = os.path.join(PROJECT_DIR, "version_info.txt")
icon_file      = os.path.join(PROJECT_DIR, "adarsh_engine.ico")
manifest_file  = os.path.join(PROJECT_DIR, "app.manifest")

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AdarshEngine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,              # !! DISABLED — UPX packing triggers antivirus false positives
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # windowless for service / tray usage
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # ── Embed custom icon (adarsh_cropper.ico) ──────────────────────
    icon=icon_file if os.path.exists(icon_file) else None,
    # ── Embed version info (visible in Properties → Details) ────────
    version=version_file if os.path.exists(version_file) else None,
    # ── Embed Windows app manifest (DPI-awareness + trust info) ─────
    # A proper manifest helps SmartScreen inspect the app metadata and
    # avoids the "Unknown App" heuristic that triggers the hard block.
    manifest=manifest_file if os.path.exists(manifest_file) else None,
)
