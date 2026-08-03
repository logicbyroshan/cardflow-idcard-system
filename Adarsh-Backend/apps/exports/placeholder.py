"""
Template Placeholder Parser
Supports {{field_name}} and {{photo}}, {{name}}, {{class}}, etc.
"""
import re
from typing import Dict, Any


PLACEHOLDER_RE = re.compile(r'\{\{\s*(\w+)\s*\}\}')


class PlaceholderParser:
    """
    Resolves {{placeholder}} tokens in a template body.

    The context dict has keys that are field names (lower-cased and slugified)
    or well-known aliases:
        - name, class, section, roll_no, photo, ...
        - Any dynamic field name derived from Field.name
    """

    @staticmethod
    def build_context(card, fields) -> Dict[str, Any]:
        """
        Build a rendering context from a Card instance and its table's Fields.

        Returns a dict like:
            {
                "name": "John Doe",
                "class": "10",
                "photo": "<media_id or None>",
                ...
            }
        """
        ctx = {}
        for field in fields:
            field_id_str = str(field.id)
            raw_value = card.data.get(field_id_str)
            key = PlaceholderParser._field_key(field.name)
            ctx[key] = raw_value if raw_value is not None else ''
            # Also expose by field UUID so templates can reference {{<uuid>}}
            ctx[field_id_str] = raw_value if raw_value is not None else ''

        return ctx

    @staticmethod
    def _field_key(name: str) -> str:
        """Normalise a field name to a safe placeholder key."""
        return re.sub(r'[^a-zA-Z0-9_]', '_', name.strip().lower())

    @staticmethod
    def render(body: str, context: Dict[str, Any]) -> str:
        """
        Replace all {{placeholder}} tokens in body with values from context.
        Unknown tokens are left as empty string.
        """
        def replacer(match):
            key = match.group(1).strip().lower()
            return str(context.get(key, ''))

        return PLACEHOLDER_RE.sub(replacer, body)

    @staticmethod
    def list_placeholders(body: str):
        """Return a list of placeholder names found in a template body."""
        return list(set(PLACEHOLDER_RE.findall(body)))

    @staticmethod
    def validate_placeholders(body: str, available_field_names: list) -> list:
        """
        Return a list of placeholders that have no matching field.
        Well-known aliases are always considered valid.
        """
        well_known = {'name', 'class', 'section', 'roll_no', 'photo', 'date', 'display_id'}
        normalised_fields = {PlaceholderParser._field_key(n) for n in available_field_names}
        all_valid = well_known | normalised_fields

        unknown = []
        for ph in PlaceholderParser.list_placeholders(body):
            if ph.lower() not in all_valid:
                unknown.append(ph)
        return unknown
