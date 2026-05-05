"""
Batch renaming service.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..renamer import batch_rename, generate_preview, get_supported_operations as _get_supported_operations
from .common import ensure_folder


def rename_preview(
    folder_path: str,
    operation: str,
    params: Dict | None = None,
    file_list: List[str] | None = None,
) -> Dict[str, Any]:
    folder = ensure_folder(folder_path)
    return generate_preview(
        folder_path=str(folder),
        operation=operation,
        params=params,
        file_list=file_list,
    )


def rename_execute(
    folder_path: str,
    operation: str,
    params: Dict | None = None,
    file_list: List[str] | None = None,
    skip_conflicts: bool = True,
) -> Dict[str, Any]:
    folder = ensure_folder(folder_path)
    return batch_rename(
        folder_path=str(folder),
        operation=operation,
        params=params,
        file_list=file_list,
        skip_conflicts=skip_conflicts,
    )


def get_supported_operations() -> List[Dict[str, str]]:
    return _get_supported_operations()
