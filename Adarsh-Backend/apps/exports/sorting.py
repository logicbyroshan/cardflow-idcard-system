"""
Export Sorting Engine

Sorts cards by: Class → Section → Name (all text field lookups by conventional field names).
"""
import re
from django.db.models import QuerySet
from apps.fields.models import Field, FieldType


def _find_field_id(fields, *aliases) -> str | None:
    """Return the field id whose normalised name matches any of the given aliases."""
    normalised = {re.sub(r'[^a-zA-Z0-9]', '', f.name.strip().lower()): str(f.id) for f in fields}
    for alias in aliases:
        for key, fid in normalised.items():
            if alias in key or key in alias:
                return fid
    return None


def sort_cards(cards: list, fields) -> list:
    """
    Sort card dicts (or Card ORM objects) by Class → Section → Name.

    `fields` is a queryset or list of Field objects for the table.
    """
    class_fid = _find_field_id(fields, 'class', 'cls', 'grade')
    section_fid = _find_field_id(fields, 'section', 'div', 'division')
    name_fid = _find_field_id(fields, 'name', 'fullname', 'studentname', 'fname')

    def sort_key(card):
        data = card.data if hasattr(card, 'data') else card.get('data', {})
        cls = str(data.get(class_fid, '') or '') if class_fid else ''
        sec = str(data.get(section_fid, '') or '') if section_fid else ''
        nm = str(data.get(name_fid, '') or '') if name_fid else ''
        return (cls.lower(), sec.lower(), nm.lower())

    return sorted(cards, key=sort_key)


def get_sort_field_ids(fields) -> dict:
    """Return a dict of sort field ids for context."""
    return {
        'class_fid': _find_field_id(fields, 'class', 'cls', 'grade'),
        'section_fid': _find_field_id(fields, 'section', 'div', 'division'),
        'name_fid': _find_field_id(fields, 'name', 'fullname', 'studentname'),
    }
