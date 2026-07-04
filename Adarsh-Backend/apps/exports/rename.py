"""
ZIP Export Rename Engine

Supports patterns like:
    {name}
    {name}_{class}
    {name}_{section}
    {roll_no}
    {display_id}
    and any dynamic field key
"""
import re
import os


RENAME_TOKEN_RE = re.compile(r'\{(\w+)\}')


class RenameEngine:
    @staticmethod
    def build_filename(pattern: str, context: dict, extension: str, index: int = 0) -> str:
        """
        Apply the rename pattern using the context dict.

        Unknown tokens are replaced with 'unknown'.
        Trailing extension (with dot) is appended automatically.
        Index is appended to ensure uniqueness if needed.
        """
        def replacer(match):
            key = match.group(1).lower()
            val = str(context.get(key, 'unknown') or 'unknown').strip()
            # Sanitise filesystem-unsafe chars
            val = re.sub(r'[\\/:*?"<>|]', '_', val)
            return val or 'unknown'

        name = RENAME_TOKEN_RE.sub(replacer, pattern)
        # Normalise to lowercase, remove leading/trailing underscores
        name = name.lower().strip('_').strip() or f'image_{index}'
        # Ensure extension
        if not extension.startswith('.'):
            extension = '.' + extension
        return f"{name}{extension}"

    @staticmethod
    def list_tokens(pattern: str) -> list:
        """Return all token names found in a pattern."""
        return list(set(RENAME_TOKEN_RE.findall(pattern)))
