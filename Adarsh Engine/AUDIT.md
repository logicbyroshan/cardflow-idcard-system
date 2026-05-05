# ADARSH ENGINE — Full Audit Report
## Version 2.2.0 | March 2026

---

## FEATURE INVENTORY

### API Endpoints (FastAPI on 127.0.0.1:4765)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/status` | Version check — `{"status":"running","version":"2.2.0"}` |
| GET | `/health` | Memory + uptime probe — includes `memory_usage_mb` via psutil |
| GET | `/config` | Returns user-configured default output directory |
| POST | `/process-zip` | Upload a ZIP of photos → face-crop all → return summary JSON |
| POST | `/process-folder` | JSON body with `folder_path` → face-crop all → return summary |
| POST | `/compress-folder` | JSON body with `folder_path + target_kb` → compress to target size |
| GET | `/preview` | List image filenames in a folder (for panel preview grid) |
| GET | `/serve-image` | Serve a single image file from local filesystem |

### Processing Pipeline (per image)

1. **Stage 0 — Frontal Face Validation**: MediaPipe FaceMesh landmark checks (eyes, nose, mouth). Rejects backs-of-head, side profiles, heavy rotation.
2. **Stage 1 — Selfie Segmentation**: MediaPipe ImageSegmenter → binary mask → hair crown detection.
3. **Stage 2 — Face Detection**: FaceMesh 478 landmarks, FaceDetector fallback → chin_y, face_height, face_center_x.
4. **Stage 3 — Passport Crop Box**: shoulder extension 0.75×face_height, top margin 0.08×face_height. Horizontal centering. Shift-don't-shrink boundary clamping.
5. **Stage 4 — Final Resize**: 413×531 px, LANCZOS resampling.
6. **Stage 5 — Validation**: NO_FACE_DETECTED, CROP_INVALID, RATIO_INVALID, CORRUPTED_IMAGE.

### Additional Features

- **Image Compression** (`/compress-folder`): Binary-search JPEG quality (5–95) to hit target KB while maximizing quality. Progressive JPEG + optimized Huffman tables.
- **ZIP Upload Streaming**: 4 MB chunk streaming — never loads entire ZIP into RAM. Supports multi-GB uploads.
- **Parallel Processing**: ThreadPoolExecutor with up to 4 workers.
- **Self-Installing Windows Service**: Inno Setup installer auto-installs via NSSM, sets up log rotation, auto-restart on crash.
- **Log Rotation**: 5 MB max, 3 backups. Separate service.log / error.log via NSSM.
- **Image Preview API**: Panel can list processed files and serve individual images for preview.
- **Output Config**: Installer writes `output_config.ini` with user-chosen output folder. Engine reads it at startup.
- **Version Embedding**: PyInstaller version_info.txt embeds metadata visible in EXE Properties → Details.

---

## SECURITY AUDIT

### ✅ Good Practices Already In Place

| Item | Status | Detail |
|---|---|---|
| Localhost-only binding | ✅ | Binds to `127.0.0.1:4765` — never reachable from network |
| Localhost enforcement middleware | ✅ | Middleware rejects any request not from `127.0.0.1` / `::1` / `localhost` |
| API key on POST endpoints | ✅ | `X-ENGINE-KEY` header required on all mutating requests |
| CORS allowlist | ✅ | Only panel + adarshbhopal.in origins allowed |
| No UPX compression | ✅ | UPX disabled in spec — prevents antivirus false positives |
| App manifest embedded | ✅ | DPI awareness, trustInfo, Windows 10/11 compatibility declared |
| Windows version info embedded | ✅ | EXE Properties shows company name, version, copyright |
| Streaming ZIP upload | ✅ | 4 MB chunks — safe for multi-GB files, no RAM bomb |
| Max ZIP size constant | ✅ | 5 GB limit in config.py |
| Max image size constant | ✅ | 50 MB per image |
| Max images per ZIP | ✅ | 50,000 images |
| Temp file cleanup | ✅ | `finally` block deletes temp ZIP after processing |
| Graceful shutdown | ✅ | SIGTERM/SIGINT handlers for clean NSSM service stop |

### ⚠ Security Issues Found

#### ISSUE 1 — Hardcoded Default API Key (Medium)
**File:** `main.py` line ~55  
```python
ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY", "passport-engine-local-key")
```
**Risk:** The default key `"passport-engine-local-key"` is published in the source code.
Any attacker who reads the code (or decompiles the EXE) knows the key.  
**Fix:** Generate a random key on first run and persist it to a local config file.
```python
# Suggested fix in main.py:
def _load_or_create_api_key() -> str:
    key_file = Path(sys.executable).parent / "engine.key" if getattr(sys, 'frozen', False) \
        else Path(__file__).parent / "engine.key"
    if key_file.is_file():
        return key_file.read_text().strip()
    import secrets
    key = secrets.token_urlsafe(32)
    key_file.write_text(key)
    return key

ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY") or _load_or_create_api_key()
```

#### ISSUE 2 — Path Traversal Risk in `/serve-image` (Low, mitigated by localhost-only)
**File:** `main.py` – `serve_image_endpoint`  
```python
file_path = Path(path)
if not file_path.is_file(): raise 404
if file_path.suffix.lower() not in _IMAGE_EXTS: raise 400
```
**Risk:** Any local image file can be served if an attacker controls a localhost process.
Since the engine is localhost-only and requires an API key on GETs... wait, GET endpoints
skip the API key check (by design). So any process on the machine can request any .jpg path.  
**Fix:** Restrict to subdirectories of known safe roots (output folders):
```python
# Validate path is inside an allowed root
_SAFE_ROOTS = [config.OUTPUT_DIR, config.CROPPED_DIR]

def _is_safe_path(p: Path) -> bool:
    resolved = p.resolve()
    return any(
        resolved.is_relative_to(root.resolve()) 
        for root in _SAFE_ROOTS 
        if root.exists()
    )
```

#### ISSUE 3 — No Rate Limiting (Low, localhost-only mitigates)
**Risk:** Malicious local process could flood `/process-zip` with large ZIPs,
exhausting CPU/memory.  
**Fix:** Add a simple semaphore to limit concurrent processing jobs:
```python
import asyncio
_PROCESS_SEMAPHORE = asyncio.Semaphore(2)  # max 2 concurrent processing jobs

@app.post("/process-zip")
async def process_zip_endpoint(...):
    async with _PROCESS_SEMAPHORE:
        ...
```

#### ISSUE 4 — GET endpoints skip API key (Informational)
`verify_localhost_and_key` skips key check for GET requests.  
`/preview?folder=...` and `/serve-image?path=...` are therefore accessible to
any localhost process without a key. This is acceptable for a local service
but worth noting.

---

## PERFORMANCE AUDIT

### ✅ Good Performance Practices

| Item | Status | Detail |
|---|---|---|
| ThreadPoolExecutor | ✅ | Up to 4 workers — parallel image processing |
| Worker count bounded | ✅ | `min(4, cpu_count)` — won't overload desktop CPU |
| LANCZOS resampling | ✅ | Best quality for downsampling |
| Binary search compression | ✅ | O(log N) quality steps — efficient |
| Streaming ZIP upload | ✅ | 4 MB chunks — constant RAM usage regardless of ZIP size |
| UPX disabled | ✅ | Avoids decompression overhead at startup |
| Log rotation | ✅ | 5 MB files, 3 backups — no unbounded log growth |
| Temp file cleanup | ✅ | Upload temps deleted immediately after processing |

### ⚠ Performance Issues Found

#### PERF 1 — MediaPipe Models Reloaded Per Request (High Impact)
**File:** `processor.py`  
**Problem:** `ImageProcessor` instantiates MediaPipe models on every call.
Each model load ~200–500ms. For large ZIP batches this is fine (one load per batch),
but for rapid single-image requests the startup overhead dominates.  
**Fix:** Cache the `ImageProcessor` instance at module level (singleton):
```python
# In processor.py or engine.py:
_PROCESSOR_INSTANCE: ImageProcessor | None = None

def _get_processor() -> ImageProcessor:
    global _PROCESSOR_INSTANCE
    if _PROCESSOR_INSTANCE is None:
        _PROCESSOR_INSTANCE = ImageProcessor()
    return _PROCESSOR_INSTANCE
```

#### PERF 2 — ThreadPoolExecutor Recreated Per Batch (Medium)
**File:** `processor.py`  
**Problem:** `ThreadPoolExecutor(max_workers=_MAX_WORKERS)` is created inside `process_batch()`
so a new thread pool is spun up for every ZIP/folder request.  
**Fix:** Create a module-level executor:
```python
_EXECUTOR = ThreadPoolExecutor(max_workers=_MAX_WORKERS)
```

#### PERF 3 — GC Call After Every Batch (Low)
**File:** `processor.py`  
`gc.collect()` is called after every batch. Unnecessary — Python's GC handles this.
It adds ~10–50ms and can cause frame drops in a service context.  
**Fix:** Remove `gc.collect()` calls.

#### PERF 4 — ZIP Extraction to Temp Dir (Informational)
The engine extracts ZIP contents to a temp dir before processing. For very large ZIPs
on machines with small temp partitions (C: nearly full), extraction can fail.  
**Fix:** Allow configuring the temp dir via `TMPDIR` env var in the service setup.
Already handled via `tempfile` which respects `TMPDIR`/`TEMP`/`TMP` — no change needed.

---

## FEATURE GAPS (for future development)

| Feature | Priority | Notes |
|---|---|---|
| EXE tray icon | High | Engine runs headlessly — no way to see if it's running without curl/netstat |
| Auto-update mechanism | Medium | Manual replacement needed on every new version |
| Per-request progress SSE | Medium | Panel shows no progress bar during large ZIP processing |
| HTTPS for localhost | Low | HTTP is fine for localhost; still worth noting |
| Image rotation correction | High | Rotated/upside-down input photos are rejected (NO_VALID_FACE) instead of auto-corrected |
| Batch size limit per request | Medium | No per-request cap; one 50,000-image ZIP uses all workers for a long time |
| API key rotation endpoint | Low | Currently requires service restart to change key |

---

## EXE FUNCTIONALITY VERIFICATION

### What the EXE does when run

`AdarshEngine.exe` is a **background service**, not a GUI app. Running it directly:
- Opens NO visible window (built with `console=False`)
- Starts FastAPI on `127.0.0.1:4765`
- Writes logs to `./logs/adarsh_engine.log`
- Exits if port 4765 is already in use (double-start guard)

### How to verify it's working

```powershell
# Start
.\dist\AdarshEngine.exe

# In another terminal
curl http://127.0.0.1:4765/status
# → {"status":"running","version":"2.2.0"}

curl http://127.0.0.1:4765/health
# → {"engine":"AdarshEngine","version":"2.2.0","status":"healthy","uptime_seconds":5.2,"memory_usage_mb":85.4}
```

### What the installer does

`AdarshEngineSetup.exe` (built by Inno Setup from `installer.iss`):
1. Shows GUI wizard — choose install directory + output folder
2. Copies `AdarshEngine.exe`, `nssm.exe`, `VERSION.txt`, `models/` to install dir
3. Stops any old `AdarshEngine` / `AdarshCropper` / `PassportEngine` service
4. Installs `AdarshEngine` Windows service via NSSM
5. Configures auto-restart, logging, service account (LocalSystem)
6. Starts the service

### Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| No GUI appears when running installer | Defender quarantined the file | Open Windows Security → Protection History → Allow |
| "Unknown Publisher" in UAC | Unsigned EXE | Run `sign_self.ps1` |
| Blue "Windows protected your PC" screen | No SmartScreen reputation + unsigned | Click "More info → Run anyway". Long-term: buy code signing cert |
| Service installed but port 4765 not responding | EXE crashed at startup | Check `logs\error.log` in install dir |
| "Access is denied" during install | Not running as admin | Right-click installer → Run as administrator |

---

*Audit completed: March 2026 — Reviewed by: GitHub Copilot*
