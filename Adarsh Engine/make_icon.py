"""
make_icon.py
────────────
Converts static/assets/AdarshEngine.png → adarsh_engine.ico
Multi-size ICO so the icon looks sharp at all resolutions.

Run from the project root:
    python "Adarsh Engine/make_icon.py"

Or from inside Adarsh Engine/:
    python make_icon.py

Requires: Pillow (pip install Pillow)
"""

import sys
from pathlib import Path

# ── Locate the PNG ────────────────────────────────────────────────────────
# Try relative to this script first, then look for the Django static folder.
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent

_PNG_CANDIDATES = [
    _PROJECT_ROOT / "static" / "assets" / "AdarshEngine.png",
    _HERE / "AdarshEngine.png",
]

src_png: Path | None = None
for candidate in _PNG_CANDIDATES:
    if candidate.is_file():
        src_png = candidate
        break

if src_png is None:
    print("ERROR: AdarshEngine.png not found. Searched:")
    for c in _PNG_CANDIDATES:
        print(f"  {c}")
    sys.exit(1)

print(f"Source PNG : {src_png}")

# ── Convert ───────────────────────────────────────────────────────────────
try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

img = Image.open(src_png).convert("RGBA")

# ICO sizes: Windows uses 256, 128, 64, 48, 32, 16 px
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]

out_ico = _HERE / "adarsh_engine.ico"
img.save(
    out_ico,
    format="ICO",
    sizes=sizes,
    bitmap_format="ico",
)

print(f"Output ICO : {out_ico}")
print("Done! The spec file and installer.iss already reference adarsh_engine.ico")
print("Run this script once before your next PyInstaller build.")
