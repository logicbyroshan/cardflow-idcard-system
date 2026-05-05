"""
Allow running as:
    python -m passport_engine_core <zip_file>
    python -m passport_engine_core <folder_path>

The engine auto-detects whether the argument is a ZIP file or a folder.
"""
from .engine import process_zip, process_folder
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def _log_summary(summary: dict) -> None:
    logger.info(
        "SUMMARY — total=%d  success=%d  failed=%d  accuracy=%.1f%%  "
        "time=%.2fs  output=%s  failed_dir=%s",
        summary["total"],
        summary["success"],
        summary["failed"],
        summary["accuracy"],
        summary["processing_time"],
        summary["output_folder"],
        summary["failed_folder"],
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    )

    if len(sys.argv) < 2:
        logger.error("Usage: python -m passport_engine_core <zip_or_folder>")
        sys.exit(1)

    target = Path(sys.argv[1])

    if target.is_dir():
        logger.info("Processing folder: %s", target)
        summary = process_folder(str(target))
    elif target.is_file() and target.suffix.lower() == ".zip":
        logger.info("Processing ZIP: %s", target)
        summary = process_zip(str(target))
    else:
        logger.error("Argument must be a .zip file or a folder: %s", target)
        sys.exit(1)

    _log_summary(summary)
