"""
main.py
───────
Production-ready FastAPI entry point for the Adarsh Engine — Photo Processing Engine.

Binds only to localhost (127.0.0.1:4765). Designed to run as a
Windows background service via NSSM + PyInstaller.

Endpoints:
    GET  /status          → version check
    GET  /health          → memory + uptime health probe
    POST /process-zip     → accept ZIP file upload
    POST /process-folder  → accept JSON folder path

Environment variables:
    PASSPORT_ENGINE_MODE  → set to "service" for silent/minimal logging
    ENGINE_API_KEY        → override default internal API key

Run:
    python main.py
    AdarshCropper.exe          (after PyInstaller build)
"""

import logging
import logging.handlers
import os
import signal
import socket
import sys
import mimetypes
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from passport_engine_core import process_zip, process_folder
from passport_engine_core.compressor import compress_folder
from passport_engine_core.config import ENGINE_VERSION

# ── Constants ────────────────────────────────────────────────────────────

HOST = "127.0.0.1"
PORT = 4765

# Service mode: when PASSPORT_ENGINE_MODE=service, use minimal logging.
SERVICE_MODE = os.environ.get("PASSPORT_ENGINE_MODE", "").lower() == "service"

# Internal API key — must be sent as the X-ENGINE-KEY header.
ENGINE_API_KEY = os.environ.get("ENGINE_API_KEY", "passport-engine-local-key")

# Allowed CORS origins.
ALLOWED_ORIGINS = [
    "http://localhost",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "https://panel.adarshbhopal.in",
    "https://adarshbhopal.in",
]

# ── Logging ──────────────────────────────────────────────────────────────

_LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s"


# ── Port guard (runs before logging so it works even when log dir is locked) ──

def _port_in_use(host: str, port: int) -> bool:
    """Return True if *port* on *host* is already bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


# Early double-start guard — before any file I/O that could fail
if __name__ == "__main__" and _port_in_use(HOST, PORT):
    print(
        f"AdarshEngine is already running on {HOST}:{PORT} \u2014 exiting.",
        file=sys.stderr,
    )
    sys.exit(0)


def _configure_logging() -> None:
    """
    Set up root logger with:
      - Console handler  (WARNING in service mode, INFO in dev mode)
      - Rotating file handler to ``logs/passport_engine.log``
        (5 MB max, 3 backups)
    Falls back to a temp-dir log if the primary location is not writable.
    """
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # ── Console ──────────────────────────────────────────────────────
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.WARNING if SERVICE_MODE else logging.INFO)
    console.setFormatter(logging.Formatter(_LOG_FORMAT))
    root.addHandler(console)

    # ── Rotating file ────────────────────────────────────────────────
    if SERVICE_MODE:
        log_dir = Path(r"C:\Program Files\Adarsh Engine\logs")
    elif getattr(sys, "frozen", False):
        # PyInstaller exe – put logs next to the .exe, not in temp dir
        log_dir = Path(sys.executable).resolve().parent / "logs"
    else:
        log_dir = Path(__file__).resolve().parent / "logs"

    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "adarsh_engine.log"
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=5 * 1024 * 1024,   # 5 MB
            backupCount=3,
            encoding="utf-8",
        )
    except PermissionError:
        # Fallback: user ran exe outside service context without write perms
        fallback = Path(tempfile.gettempdir()) / "AdarshEngine" / "logs"
        fallback.mkdir(parents=True, exist_ok=True)
        log_file = fallback / "adarsh_cropper.log"
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        root.warning("Log dir %s not writable, using %s", log_dir, fallback)

    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    root.addHandler(file_handler)


_configure_logging()
logger = logging.getLogger(__name__)

# ── Startup timestamp (for uptime tracking) ──────────────────────────────
_start_time: float = 0.0


# ── Lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _start_time
    _start_time = time.monotonic()
    logger.info(
        "AdarshEngine v%s started on %s:%d", ENGINE_VERSION, HOST, PORT
    )
    yield
    logger.info("AdarshEngine v%s shut down.", ENGINE_VERSION)


# ── App ──────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AdarshEngine",
    version=ENGINE_VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ── Global exception handlers ───────────────────────────────────────────

def _error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": True, "code": code, "message": message},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return _error_response(exc.status_code, "REQUEST_ERROR", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return _error_response(422, "VALIDATION_ERROR", "Invalid request parameters.")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return _error_response(500, "ENGINE_ERROR", "Internal processing error.")


# ── Security middleware ──────────────────────────────────────────────────

@app.middleware("http")
async def verify_localhost_and_key(request: Request, call_next):
    """
    1. Reject requests not from the loopback interface.
    2. Require a valid X-ENGINE-KEY header on mutating endpoints.
    Skip checks for CORS preflight (OPTIONS) requests.
    """
    # ── Skip CORS preflight requests ─────────────────────────────────
    if request.method == "OPTIONS":
        return await call_next(request)

    # ── Localhost-only guard ─────────────────────────────────────────
    client_host = request.client.host if request.client else None
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        return _error_response(403, "FORBIDDEN", "Only localhost access is permitted.")

    # ── API-key guard (skip for GET) ─────────────────────────────────
    if request.method != "GET":
        key = request.headers.get("X-ENGINE-KEY", "")
        if key != ENGINE_API_KEY:
            return _error_response(401, "UNAUTHORIZED", "Invalid or missing X-ENGINE-KEY header.")

    return await call_next(request)


# ── Request models ───────────────────────────────────────────────────────

class FolderRequest(BaseModel):
    folder_path: str


class CompressRequest(BaseModel):
    folder_path: str
    target_kb: float


class AdjustImageRequest(BaseModel):
    """Request model for /adjust-image endpoint."""
    image_path: str           # Full path to source image
    output_path: str          # Full path to save adjusted image
    black_point: int = 0      # Levels black point (0-254)
    gamma: float = 1.0        # Gamma correction (0.01-3.0)


class RenamePreviewRequest(BaseModel):
    """Request model for /rename-preview endpoint."""
    folder_path: str                      # Folder containing images
    operation: str                        # RenameOperation enum value
    params: dict = {}                     # Operation-specific parameters
    file_list: list[str] | None = None    # Optional specific files


class RenameExecuteRequest(BaseModel):
    """Request model for /rename-execute endpoint."""
    folder_path: str                      # Folder containing images
    operation: str                        # RenameOperation enum value
    params: dict = {}                     # Operation-specific parameters
    file_list: list[str] | None = None    # Optional specific files
    skip_conflicts: bool = True           # Skip conflicting renames
    white_point: int = 255    # Levels white point (1-255)
    vibrance: int = 0         # Vibrance adjustment (-100 to 100)
    temperature: int = 0      # Temperature adjustment (-100 to 100)


# ── Routes ───────────────────────────────────────────────────────────────

@app.get("/status")
def status():
    return {"status": "running", "version": ENGINE_VERSION}


@app.get("/config")
def config_endpoint():
    """Return the engine's user-configured settings (e.g. default output dir)."""
    from passport_engine_core.config import DEFAULT_OUTPUT_DIR
    return {
        "default_output_dir": str(DEFAULT_OUTPUT_DIR) if DEFAULT_OUTPUT_DIR else "",
    }


@app.get("/health")
def health():
    """Lightweight health probe with uptime and optional memory usage."""
    uptime = round(time.monotonic() - _start_time, 2) if _start_time else 0.0

    info: dict = {
        "engine": "AdarshEngine",
        "version": ENGINE_VERSION,
        "status": "healthy",
        "uptime_seconds": uptime,
    }

    # Memory usage — best-effort via psutil (not a hard dependency).
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        info["memory_usage_mb"] = round(proc.memory_info().rss / (1024 * 1024), 2)
    except ImportError:
        info["memory_usage_mb"] = None
    except Exception:
        info["memory_usage_mb"] = None

    return info


@app.post("/process-zip")
async def process_zip_endpoint(
    file: UploadFile = File(...),
    original_path: str | None = Form(None),
    output_folder: str | None = Form(None),
):
    """
    Accept a ZIP upload, process it, return summary JSON.

    Pass *original_path* (form field) so that output folders are
    created beside the original ZIP file instead of in the temp
    directory.

    Streams the upload to disk in chunks to avoid loading the entire
    file into RAM (supports multi-GB uploads).
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted.")

    tmp_path: Path | None = None

    try:
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=suffix, prefix="upload_"
        ) as tmp:
            tmp_path = Path(tmp.name)
            # Stream to disk in 4 MB chunks — never hold full file in RAM
            total_bytes = 0
            while True:
                chunk = await file.read(4 * 1024 * 1024)  # 4 MB
                if not chunk:
                    break
                tmp.write(chunk)
                total_bytes += len(chunk)

        logger.info("Processing uploaded ZIP: %s (%d bytes)", file.filename, total_bytes)
        summary = process_zip(
            str(tmp_path),
            original_path=original_path,
            output_folder=output_folder,
        )
        return JSONResponse(content=summary)

    except FileNotFoundError as exc:
        logger.error("File error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))

    except ValueError as exc:
        logger.warning("Validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception:
        logger.exception("Unexpected error during ZIP processing.")
        raise HTTPException(status_code=500, detail="Internal processing error.")

    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


@app.post("/process-folder")
async def process_folder_endpoint(body: FolderRequest):
    """Accept a folder path via JSON, process it, return summary JSON."""
    folder = Path(body.folder_path)

    if not folder.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {body.folder_path}")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.folder_path}")

    try:
        logger.info("Processing folder: %s", body.folder_path)
        summary = process_folder(body.folder_path)
        return JSONResponse(content=summary)

    except ValueError as exc:
        logger.warning("Validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception:
        logger.exception("Unexpected error during folder processing.")
        raise HTTPException(status_code=500, detail="Internal processing error.")


@app.post("/compress-folder")
async def compress_folder_endpoint(body: CompressRequest):
    """
    Accept a folder path + target KB via JSON, compress all images in the
    folder to ≤ target_kb while preserving maximum quality.
    Returns summary JSON matching the process-folder response shape.
    """
    folder = Path(body.folder_path)

    if not folder.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {body.folder_path}")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.folder_path}")
    if body.target_kb <= 0:
        raise HTTPException(status_code=400, detail="target_kb must be greater than 0.")

    try:
        logger.info("Compressing folder: %s (target: %.1f KB)", body.folder_path, body.target_kb)
        summary = compress_folder(body.folder_path, body.target_kb)
        return JSONResponse(content=summary)

    except ValueError as exc:
        logger.warning("Compression validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception:
        logger.exception("Unexpected error during compression.")
        raise HTTPException(status_code=500, detail="Internal compression error.")


@app.post("/adjust-image")
async def adjust_image_endpoint(body: AdjustImageRequest):
    """
    Apply image adjustments (levels, vibrance, temperature) and save result.
    
    This endpoint processes the image at full resolution using Pillow/numpy
    for professional-quality output. Used for final image saves while the
    browser handles real-time previews via Canvas.
    
    Returns:
        - success: True if adjustment and save completed
        - output_path: Path where the adjusted image was saved
        - error: Error message if failed
    """
    from passport_engine_core.adjustments import apply_adjustments
    
    # Validate input path
    image_path = Path(body.image_path)
    if not image_path.exists():
        raise HTTPException(status_code=400, detail=f"Source image not found: {body.image_path}")
    if not image_path.is_file():
        raise HTTPException(status_code=400, detail=f"Path is not a file: {body.image_path}")
    
    # Validate output path
    output_path = Path(body.output_path)
    if not output_path.suffix.lower() in ('.jpg', '.jpeg', '.png'):
        raise HTTPException(status_code=400, detail="Output must be .jpg, .jpeg, or .png")
    
    try:
        logger.info(
            "Adjusting image: %s → %s (levels=%d/%0.2f/%d, vib=%d, temp=%d)",
            body.image_path, body.output_path,
            body.black_point, body.gamma, body.white_point,
            body.vibrance, body.temperature
        )
        
        result_image, error = apply_adjustments(
            image_path=body.image_path,
            black_point=body.black_point,
            gamma=body.gamma,
            white_point=body.white_point,
            vibrance=body.vibrance,
            temperature=body.temperature,
            output_path=body.output_path,
        )
        
        if error:
            logger.error("Adjustment failed: %s", error)
            return JSONResponse(
                status_code=500,
                content={"success": False, "error": error}
            )
        
        logger.info("Adjustment complete: %s", body.output_path)
        return JSONResponse(content={
            "success": True,
            "output_path": str(output_path),
            "message": "Image adjusted and saved successfully"
        })
    
    except ValueError as exc:
        logger.warning("Adjustment validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    
    except Exception:
        logger.exception("Unexpected error during image adjustment.")
        raise HTTPException(status_code=500, detail="Internal adjustment error.")


@app.post("/rename-preview")
async def rename_preview_endpoint(body: RenamePreviewRequest):
    """
    Generate a preview of batch rename operations without executing.
    
    Returns a list of original → new filename mappings for UI preview.
    Detects conflicts (files that would overwrite each other).
    """
    from passport_engine_core.renamer import generate_preview
    
    folder = Path(body.folder_path)
    
    if not folder.exists():
        raise HTTPException(status_code=400, detail=f"Folder not found: {body.folder_path}")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a folder: {body.folder_path}")
    
    try:
        logger.info("Generating rename preview: %s (op=%s)", body.folder_path, body.operation)
        result = generate_preview(
            folder_path=body.folder_path,
            operation=body.operation,
            params=body.params,
            file_list=body.file_list
        )
        return JSONResponse(content=result)
    
    except ValueError as exc:
        logger.warning("Rename preview validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    
    except Exception:
        logger.exception("Unexpected error generating rename preview.")
        raise HTTPException(status_code=500, detail="Internal rename preview error.")


@app.post("/rename-execute")
async def rename_execute_endpoint(body: RenameExecuteRequest):
    """
    Execute batch rename operations on files in a folder.
    
    Returns summary of renamed, skipped, and failed files.
    """
    from passport_engine_core.renamer import batch_rename
    
    folder = Path(body.folder_path)
    
    if not folder.exists():
        raise HTTPException(status_code=400, detail=f"Folder not found: {body.folder_path}")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a folder: {body.folder_path}")
    
    try:
        logger.info(
            "Executing batch rename: %s (op=%s, skip_conflicts=%s)",
            body.folder_path, body.operation, body.skip_conflicts
        )
        result = batch_rename(
            folder_path=body.folder_path,
            operation=body.operation,
            params=body.params,
            file_list=body.file_list,
            skip_conflicts=body.skip_conflicts
        )
        return JSONResponse(content=result)
    
    except ValueError as exc:
        logger.warning("Rename execute validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    
    except Exception:
        logger.exception("Unexpected error during batch rename.")
        raise HTTPException(status_code=500, detail="Internal rename error.")


@app.get("/rename-operations")
async def rename_operations_endpoint():
    """
    Get list of supported rename operations with descriptions.
    Useful for populating UI dropdowns.
    """
    from passport_engine_core.renamer import get_supported_operations
    
    return JSONResponse(content={
        "success": True,
        "operations": get_supported_operations()
    })


# ── Image preview endpoints ──────────────────────────────────────────────

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


@app.get("/preview")
async def preview_endpoint(folder: str = Query("", description="Folder path to list images from")):
    """
    Return a JSON list of image filenames inside a local folder.
    Used by the panel to populate the preview grid after processing.
    """
    folder = folder.strip()
    if not folder:
        return JSONResponse(content={"files": []})

    folder_path = Path(folder)
    if not folder_path.is_dir():
        return JSONResponse(content={"files": []})

    files = sorted(
        f.name for f in folder_path.iterdir()
        if f.is_file() and f.suffix.lower() in _IMAGE_EXTS
    )
    return JSONResponse(content={"files": files, "folder": str(folder_path)})


@app.get("/serve-image")
async def serve_image_endpoint(path: str = Query("", description="Full path to image file")):
    """
    Serve a single image file from the local filesystem.
    Security: only serves files with image extensions.
    """
    path = path.strip()
    if not path:
        raise HTTPException(status_code=400, detail="path parameter required")

    file_path = Path(path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    if file_path.suffix.lower() not in _IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Not an image file")

    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    return FileResponse(str(file_path), media_type=content_type)


# ── Graceful shutdown (SIGTERM / SIGINT) ─────────────────────────────────

_server = None  # set in __main__ block


def _graceful_shutdown(signum, frame):
    """Handle SIGTERM/SIGINT so NSSM service stops cleanly."""
    sig_name = signal.Signals(signum).name
    logger.info("Received %s — initiating graceful shutdown.", sig_name)
    if _server is not None:
        _server.should_exit = True


# ── Entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    import uvicorn

    signal.signal(signal.SIGINT, _graceful_shutdown)
    signal.signal(signal.SIGTERM, _graceful_shutdown)

    config = uvicorn.Config(
        app,
        host=HOST,
        port=PORT,
        log_level="warning",
        log_config=None,        # we handle logging ourselves
    )
    _server = uvicorn.Server(config)
    _server.run()
