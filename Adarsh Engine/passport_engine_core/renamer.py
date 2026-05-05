"""
passport_engine_core/renamer.py
--------------------------------
Batch file renaming helpers used by Adarsh Engine endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List

from . import config

_CAMERA_PREFIXES = (
    "DSC_",
    "IMG_",
    "PXL_",
    "PHOTO_",
    "IMAGE_",
)


@dataclass
class RenameItem:
    original: str
    new: str
    changed: bool
    conflict: bool


def _iter_files(folder: Path, file_list: List[str] | None) -> List[Path]:
    if file_list:
        candidates = [folder / name for name in file_list]
    else:
        candidates = [p for p in folder.iterdir() if p.is_file()]

    out: List[Path] = []
    for item in candidates:
        if not item.exists() or not item.is_file():
            continue
        if item.suffix.lower() in config.ALLOWED_IMAGE_EXTENSIONS:
            out.append(item)

    out.sort(key=lambda p: p.name.lower())
    return out


def _safe_stem_and_suffix(name: str) -> tuple[str, str]:
    p = Path(name)
    suffix = p.suffix or ""
    stem = p.stem if suffix else p.name
    return stem, suffix


def _title_case_text(value: str) -> str:
    # Keep separators stable, only title-case alphanumeric chunks.
    parts = []
    token = []
    for ch in value:
        if ch.isalnum():
            token.append(ch)
        else:
            if token:
                parts.append("".join(token).capitalize())
                token = []
            parts.append(ch)
    if token:
        parts.append("".join(token).capitalize())
    return "".join(parts)


def _apply_remove_camera_prefix(stem: str) -> str:
    upper_stem = stem.upper()
    for prefix in _CAMERA_PREFIXES:
        if upper_stem.startswith(prefix):
            trimmed = stem[len(prefix):]
            return trimmed.lstrip("_- ")
    return stem


def _build_new_name(
    file_path: Path,
    operation: str,
    params: Dict,
    index: int,
) -> str:
    stem, suffix = _safe_stem_and_suffix(file_path.name)

    if operation == "add_prefix":
        new_stem = f"{params.get('prefix', '')}{stem}"
    elif operation == "add_suffix":
        new_stem = f"{stem}{params.get('suffix', '')}"
    elif operation == "remove_prefix":
        prefix = str(params.get("prefix", ""))
        new_stem = stem[len(prefix):] if prefix and stem.startswith(prefix) else stem
    elif operation == "remove_suffix":
        remove_suffix = str(params.get("suffix", ""))
        if remove_suffix and stem.endswith(remove_suffix):
            new_stem = stem[: len(stem) - len(remove_suffix)]
        else:
            new_stem = stem
    elif operation == "replace_text":
        old_text = str(params.get("old_text", ""))
        new_text = str(params.get("new_text", ""))
        new_stem = stem.replace(old_text, new_text) if old_text else stem
    elif operation == "remove_text":
        remove_text = str(params.get("text", ""))
        new_stem = stem.replace(remove_text, "") if remove_text else stem
    elif operation == "remove_camera_prefix":
        new_stem = _apply_remove_camera_prefix(stem)
    elif operation == "sequential":
        base_name = str(params.get("base_name", "")).strip() or "image"
        digits = int(params.get("digits", 3) or 3)
        start = int(params.get("start", 1) or 1)
        current = start + index
        new_stem = f"{base_name}{str(current).zfill(max(1, digits))}"
    elif operation == "lowercase":
        new_stem = stem.lower()
    elif operation == "uppercase":
        new_stem = stem.upper()
    elif operation == "title_case":
        new_stem = _title_case_text(stem)
    elif operation == "change_extension":
        new_stem = stem
        raw_ext = str(params.get("new_extension", "")).strip().lower()
        if raw_ext:
            suffix = raw_ext if raw_ext.startswith(".") else f".{raw_ext}"
    else:
        raise ValueError(f"Unsupported rename operation: {operation}")

    if not new_stem:
        new_stem = stem

    return f"{new_stem}{suffix}"


def _preview_items(
    folder: Path,
    files: Iterable[Path],
    operation: str,
    params: Dict,
) -> List[RenameItem]:
    existing_names = {p.name.lower() for p in folder.iterdir() if p.is_file()}
    target_counts: Dict[str, int] = {}

    items: List[RenameItem] = []
    for idx, file_path in enumerate(files):
        new_name = _build_new_name(file_path, operation, params, idx)
        changed = new_name != file_path.name

        key = new_name.lower()
        target_counts[key] = target_counts.get(key, 0) + 1

        # Existing-name conflict is only relevant when name changes.
        existing_conflict = changed and key in existing_names and key != file_path.name.lower()

        items.append(
            RenameItem(
                original=file_path.name,
                new=new_name,
                changed=changed,
                conflict=existing_conflict,
            )
        )

    for item in items:
        if target_counts[item.new.lower()] > 1:
            item.conflict = True

    return items


def generate_preview(
    folder_path: str,
    operation: str,
    params: Dict | None = None,
    file_list: List[str] | None = None,
) -> Dict:
    folder = Path(folder_path)
    if not folder.exists() or not folder.is_dir():
        raise ValueError(f"Invalid folder: {folder_path}")

    params = params or {}
    files = _iter_files(folder, file_list)
    items = _preview_items(folder, files, operation, params)

    files_payload = [
        {
            "original": item.original,
            "new": item.new,
            "changed": item.changed,
            "conflict": item.conflict,
        }
        for item in items
    ]

    return {
        "success": True,
        "files": files_payload,
        "total": len(files_payload),
        "changed": sum(1 for item in items if item.changed),
        "conflicts": sum(1 for item in items if item.conflict),
    }


def batch_rename(
    folder_path: str,
    operation: str,
    params: Dict | None = None,
    file_list: List[str] | None = None,
    skip_conflicts: bool = True,
) -> Dict:
    folder = Path(folder_path)
    if not folder.exists() or not folder.is_dir():
        raise ValueError(f"Invalid folder: {folder_path}")

    params = params or {}
    files = _iter_files(folder, file_list)
    items = _preview_items(folder, files, operation, params)

    renamed = 0
    skipped = 0
    errors: List[str] = []
    mappings: List[Dict[str, str]] = []

    # Two-phase rename prevents collisions when swapping names.
    phase1_moves: List[tuple[Path, Path]] = []
    phase2_moves: List[tuple[Path, Path, str]] = []

    for i, item in enumerate(items):
        src = folder / item.original
        dst = folder / item.new

        if not item.changed:
            skipped += 1
            continue

        if item.conflict and skip_conflicts:
            skipped += 1
            continue

        temp_index = 0
        tmp = folder / f".__adarsh_tmp_rename_{i}_{temp_index}{src.suffix}"
        while tmp.exists():
            temp_index += 1
            tmp = folder / f".__adarsh_tmp_rename_{i}_{temp_index}{src.suffix}"

        phase1_moves.append((src, tmp))
        phase2_moves.append((tmp, dst, src.name))

    try:
        for src, tmp in phase1_moves:
            src.rename(tmp)

        for tmp, dst, original_name in phase2_moves:
            if dst.exists():
                raise FileExistsError(f"Destination exists: {dst.name}")
            tmp.rename(dst)
            renamed += 1
            mappings.append({"original": original_name, "new": dst.name})

    except Exception as exc:
        errors.append(str(exc))
        # Best-effort rollback: move temps back to original names.
        for src, tmp in reversed(phase1_moves):
            try:
                if tmp.exists() and not src.exists():
                    tmp.rename(src)
            except Exception:
                pass

    return {
        "success": len(errors) == 0,
        "renamed": renamed,
        "skipped": skipped,
        "errors": errors,
        "mappings": mappings,
    }


def get_supported_operations() -> List[Dict[str, str]]:
    return [
        {"key": "add_prefix", "label": "Add Prefix"},
        {"key": "add_suffix", "label": "Add Suffix"},
        {"key": "remove_prefix", "label": "Remove Prefix"},
        {"key": "remove_suffix", "label": "Remove Suffix"},
        {"key": "replace_text", "label": "Replace Text"},
        {"key": "remove_text", "label": "Remove Text"},
        {"key": "remove_camera_prefix", "label": "Remove Camera Prefix"},
        {"key": "sequential", "label": "Sequential Numbering"},
        {"key": "lowercase", "label": "Lowercase"},
        {"key": "uppercase", "label": "Uppercase"},
        {"key": "title_case", "label": "Title Case"},
        {"key": "change_extension", "label": "Change Extension"},
    ]
