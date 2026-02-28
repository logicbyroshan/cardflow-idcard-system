"""
Column Width Intelligence Module
=================================
SINGLE SOURCE OF TRUTH for column sizing across PDF, Word, and HTML tables.

Given a column heading (field name), this module determines:
  - The canonical field category (e.g. ``full_name``, ``blood_group``, ``mobile``)
  - Minimum / preferred / maximum character widths
  - Whether the column content should wrap or stay on one line
  - Text alignment (left / center / right)

The recognition engine understands 90+ field-name variations commonly
found in Indian ID-card / school / HR systems (see ``FIELD_ALIASES``).

Usage::

    from exports.column_spec import classify_column, get_column_spec

    spec = get_column_spec("Father's Name")
    # => ColumnSpec(category='parent_name', min_chars=8, pref_chars=18,
    #              max_chars=28, wrap=True, align='left', ...)

    spec = get_column_spec("BG")   # Blood Group alias
    # => ColumnSpec(category='blood_group', min_chars=2, pref_chars=4, ...)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

__all__ = [
    'ColumnSpec', 'classify_column', 'get_column_spec',
    'get_pdf_width_percent', 'get_word_width_cm', 'get_html_classes',
]


# ─────────────────────────────────────────────────────────────────────
# 1. Column specifications — one entry per canonical category
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ColumnSpec:
    """Describes sizing & behaviour for a column category."""
    category: str
    # Character-count hints (for proportional width calculation)
    min_chars: int      # absolute minimum chars to display
    pref_chars: int     # preferred / typical content length
    max_chars: int      # beyond this, content MUST wrap
    # Behaviour
    wrap: bool          # True → word-wrap allowed; False → nowrap (numeric/date)
    align: str          # 'left' | 'center' | 'right'
    # PDF-specific (percent of page width)
    pdf_min_pct: float  # minimum column width in %
    pdf_max_pct: float  # maximum column width in %
    # Word-specific (cm)
    word_min_cm: float
    word_max_cm: float
    # HTML Tailwind classes
    html_th_class: str  # width/min-width classes for <th>
    html_td_class: str  # width/wrap/align classes for <td>


# ── Canonical column specs ──────────────────────────────────────────

_SPECS: Dict[str, ColumnSpec] = {}


def _s(category, min_c, pref_c, max_c, wrap, align,
       pdf_min, pdf_max, w_min, w_max, th_cls, td_cls):
    """Shorthand helper to register a ColumnSpec."""
    _SPECS[category] = ColumnSpec(
        category=category,
        min_chars=min_c, pref_chars=pref_c, max_chars=max_c,
        wrap=wrap, align=align,
        pdf_min_pct=pdf_min, pdf_max_pct=pdf_max,
        word_min_cm=w_min, word_max_cm=w_max,
        html_th_class=th_cls, html_td_class=td_cls,
    )


# ── Serial / Row number ─────────────────────────────────────────────
_s('sr_no', 2, 4, 5, False, 'center',
   2.5, 4.0, 0.8, 1.2,
   'w-[36px] min-w-[36px]',
   'w-[36px] text-center whitespace-nowrap')

# ── Names ────────────────────────────────────────────────────────────
_s('full_name', 8, 20, 35, True, 'left',
   6.0, 22.0, 2.5, 8.0,
   'min-w-[110px]',
   'min-w-[110px] text-left whitespace-normal break-words')

_s('parent_name', 8, 18, 30, True, 'left',
   5.5, 18.0, 2.0, 7.0,
   'min-w-[100px]',
   'min-w-[100px] text-left whitespace-normal break-words')

_s('guardian_name', 8, 18, 30, True, 'left',
   5.5, 18.0, 2.0, 7.0,
   'min-w-[100px]',
   'min-w-[100px] text-left whitespace-normal break-words')

_s('spouse_name', 8, 18, 30, True, 'left',
   5.5, 18.0, 2.0, 7.0,
   'min-w-[100px]',
   'min-w-[100px] text-left whitespace-normal break-words')

# ── Date fields ──────────────────────────────────────────────────────
_s('date', 8, 10, 12, False, 'center',
   4.5, 8.0, 1.8, 2.8,
   'w-[85px] min-w-[85px]',
   'w-[85px] text-center whitespace-nowrap')

# ── Age ──────────────────────────────────────────────────────────────
_s('age', 2, 3, 4, False, 'center',
   2.0, 4.0, 0.7, 1.2,
   'w-[38px] min-w-[38px]',
   'w-[38px] text-center whitespace-nowrap')

# ── Gender ───────────────────────────────────────────────────────────
_s('gender', 1, 6, 12, False, 'center',
   2.5, 5.0, 0.8, 1.5,
   'w-[48px] min-w-[48px]',
   'w-[48px] text-center whitespace-nowrap')

# ── Blood Group ──────────────────────────────────────────────────────
_s('blood_group', 2, 4, 6, False, 'center',
   2.0, 4.5, 0.7, 1.4,
   'w-[44px] min-w-[44px]',
   'w-[44px] text-center whitespace-nowrap')

# ── Nationality / Religion / Caste ───────────────────────────────────
_s('nationality', 4, 8, 15, True, 'center',
   3.5, 8.0, 1.2, 3.0,
   'min-w-[60px]',
   'min-w-[60px] text-center whitespace-normal break-words')

_s('religion', 4, 8, 15, True, 'center',
   3.0, 7.0, 1.0, 2.5,
   'min-w-[55px]',
   'min-w-[55px] text-center whitespace-normal break-words')

_s('caste_category', 3, 5, 10, False, 'center',
   2.5, 5.5, 0.8, 2.0,
   'w-[50px] min-w-[50px]',
   'w-[50px] text-center whitespace-nowrap')

_s('marital_status', 4, 8, 12, False, 'center',
   3.0, 6.0, 1.0, 2.2,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

# ── Images ───────────────────────────────────────────────────────────
_s('photo', 0, 0, 0, False, 'center',
   5.0, 9.0, 1.5, 2.5,
   'w-[60px] min-w-[60px]',
   'w-[60px] text-center')

_s('signature', 0, 0, 0, False, 'center',
   5.0, 9.0, 1.5, 2.5,
   'w-[60px] min-w-[60px]',
   'w-[60px] text-center')

_s('qr_barcode', 0, 0, 0, False, 'center',
   4.0, 7.0, 1.2, 2.0,
   'w-[50px] min-w-[50px]',
   'w-[50px] text-center')

# ── ID Numbers ───────────────────────────────────────────────────────
_s('id_number', 4, 10, 20, False, 'center',
   4.5, 10.0, 1.5, 3.5,
   'min-w-[75px]',
   'min-w-[75px] text-center whitespace-nowrap')

_s('aadhaar', 12, 14, 16, False, 'center',
   5.5, 9.0, 2.0, 3.5,
   'w-[100px] min-w-[100px]',
   'w-[100px] text-center whitespace-nowrap')

_s('pan', 10, 10, 10, False, 'center',
   4.5, 7.0, 1.8, 3.0,
   'w-[80px] min-w-[80px]',
   'w-[80px] text-center whitespace-nowrap')

_s('voter_id', 8, 12, 16, False, 'center',
   4.5, 8.0, 1.8, 3.2,
   'w-[85px] min-w-[85px]',
   'w-[85px] text-center whitespace-nowrap')

_s('driving_license', 8, 16, 20, False, 'center',
   5.0, 10.0, 2.0, 3.5,
   'min-w-[90px]',
   'min-w-[90px] text-center whitespace-nowrap')

_s('passport_number', 8, 10, 12, False, 'center',
   4.5, 7.0, 1.8, 3.0,
   'w-[80px] min-w-[80px]',
   'w-[80px] text-center whitespace-nowrap')

_s('health_id', 8, 14, 20, False, 'center',
   4.5, 8.0, 1.8, 3.2,
   'min-w-[80px]',
   'min-w-[80px] text-center whitespace-nowrap')

# ── Phone / Mobile ───────────────────────────────────────────────────
_s('mobile', 10, 12, 15, False, 'center',
   5.0, 8.0, 1.8, 3.0,
   'w-[95px] min-w-[95px]',
   'w-[95px] text-center whitespace-nowrap')

# ── Email ────────────────────────────────────────────────────────────
_s('email', 10, 22, 40, True, 'left',
   6.0, 16.0, 2.5, 6.0,
   'min-w-[110px]',
   'min-w-[110px] text-left whitespace-normal break-all')

# ── Address ──────────────────────────────────────────────────────────
_s('address', 10, 30, 60, True, 'left',
   6.0, 25.0, 2.5, 9.0,
   'min-w-[110px] max-w-[200px]',
   'min-w-[110px] max-w-[200px] text-left whitespace-normal break-words')

_s('city', 4, 10, 20, True, 'center',
   3.0, 7.0, 1.0, 3.0,
   'min-w-[60px]',
   'min-w-[60px] text-center whitespace-normal break-words')

_s('district', 4, 12, 20, True, 'center',
   3.5, 8.0, 1.2, 3.2,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('state', 4, 12, 25, True, 'center',
   3.5, 8.0, 1.2, 3.5,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('pincode', 5, 6, 8, False, 'center',
   3.0, 5.0, 1.0, 2.0,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

_s('country', 3, 6, 15, False, 'center',
   3.0, 6.0, 1.0, 2.5,
   'min-w-[55px]',
   'min-w-[55px] text-center whitespace-nowrap')

# ── Organisation / Education ─────────────────────────────────────────
_s('branch', 4, 12, 25, True, 'center',
   3.5, 10.0, 1.2, 4.0,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('department', 4, 14, 25, True, 'center',
   4.0, 12.0, 1.5, 4.5,
   'min-w-[70px]',
   'min-w-[70px] text-center whitespace-normal break-words')

_s('designation', 4, 14, 25, True, 'center',
   4.0, 12.0, 1.5, 4.5,
   'min-w-[70px]',
   'min-w-[70px] text-center whitespace-normal break-words')

_s('course', 4, 12, 30, True, 'center',
   3.5, 10.0, 1.2, 4.0,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('class_section', 2, 5, 10, False, 'center',
   2.0, 5.0, 0.7, 1.8,
   'w-[45px] min-w-[45px]',
   'w-[45px] text-center whitespace-nowrap')

_s('batch', 3, 8, 12, False, 'center',
   3.0, 6.0, 1.0, 2.2,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

_s('semester', 2, 4, 6, False, 'center',
   2.0, 4.0, 0.7, 1.5,
   'w-[45px] min-w-[45px]',
   'w-[45px] text-center whitespace-nowrap')

_s('stream', 3, 8, 15, False, 'center',
   3.0, 6.0, 1.0, 2.5,
   'min-w-[55px]',
   'min-w-[55px] text-center whitespace-nowrap')

# ── Employment ───────────────────────────────────────────────────────
_s('employee_type', 4, 10, 15, False, 'center',
   3.5, 8.0, 1.2, 3.0,
   'min-w-[60px]',
   'min-w-[60px] text-center whitespace-nowrap')

_s('grade_level', 2, 5, 10, False, 'center',
   2.5, 5.0, 0.8, 2.0,
   'w-[50px] min-w-[50px]',
   'w-[50px] text-center whitespace-nowrap')

_s('shift_timing', 4, 12, 20, False, 'center',
   4.0, 8.0, 1.2, 3.0,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-nowrap')

_s('access_level', 3, 8, 15, False, 'center',
   3.0, 6.0, 1.0, 2.5,
   'min-w-[55px]',
   'min-w-[55px] text-center whitespace-nowrap')

_s('work_location', 4, 14, 25, True, 'center',
   4.0, 10.0, 1.5, 4.0,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('employee_status', 4, 8, 12, False, 'center',
   3.0, 6.0, 1.0, 2.2,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

# ── Defence / Police ─────────────────────────────────────────────────
_s('rank', 3, 10, 20, True, 'center',
   3.5, 8.0, 1.2, 3.5,
   'min-w-[55px]',
   'min-w-[55px] text-center whitespace-normal break-words')

_s('service_number', 5, 10, 16, False, 'center',
   4.0, 8.0, 1.5, 3.0,
   'min-w-[70px]',
   'min-w-[70px] text-center whitespace-nowrap')

_s('posting_location', 5, 14, 25, True, 'center',
   4.0, 10.0, 1.5, 4.0,
   'min-w-[65px]',
   'min-w-[65px] text-center whitespace-normal break-words')

_s('validity_period', 6, 12, 20, False, 'center',
   4.5, 8.0, 1.5, 3.0,
   'min-w-[75px]',
   'min-w-[75px] text-center whitespace-nowrap')

# ── Medical ──────────────────────────────────────────────────────────
_s('allergies', 4, 15, 40, True, 'left',
   4.0, 14.0, 1.5, 5.0,
   'min-w-[70px]',
   'min-w-[70px] text-left whitespace-normal break-words')

_s('medical_condition', 4, 15, 40, True, 'left',
   4.0, 14.0, 1.5, 5.0,
   'min-w-[70px]',
   'min-w-[70px] text-left whitespace-normal break-words')

_s('disability', 4, 12, 30, True, 'left',
   3.5, 10.0, 1.2, 4.0,
   'min-w-[65px]',
   'min-w-[65px] text-left whitespace-normal break-words')

# ── Misc short fields ───────────────────────────────────────────────
_s('hostel_room', 3, 6, 10, False, 'center',
   3.0, 5.0, 0.8, 2.0,
   'w-[50px] min-w-[50px]',
   'w-[50px] text-center whitespace-nowrap')

_s('bus_route', 3, 8, 12, False, 'center',
   3.0, 6.0, 1.0, 2.5,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

_s('library_card', 4, 10, 16, False, 'center',
   3.5, 7.0, 1.2, 3.0,
   'min-w-[60px]',
   'min-w-[60px] text-center whitespace-nowrap')

_s('lab_access', 4, 8, 14, False, 'center',
   3.0, 6.0, 1.0, 2.5,
   'w-[55px] min-w-[55px]',
   'w-[55px] text-center whitespace-nowrap')

_s('reporting_manager', 6, 18, 30, True, 'left',
   5.0, 14.0, 2.0, 5.5,
   'min-w-[90px]',
   'min-w-[90px] text-left whitespace-normal break-words')

# ── Fallback (unknown fields) ───────────────────────────────────────
_s('_default', 3, 10, 30, True, 'center',
   3.5, 15.0, 1.2, 5.0,
   'min-w-[70px]',
   'min-w-[70px] text-center whitespace-normal break-words')


# ─────────────────────────────────────────────────────────────────────
# 2. Alias map — maps regex patterns → canonical category
# ─────────────────────────────────────────────────────────────────────
# Order matters: first match wins.  More specific patterns come first.
# Patterns are matched against NORMALISED field name (lowercase,
# whitespace/underscores/dots/apostrophes stripped).

FIELD_ALIASES: List[Tuple[str, str]] = [
    # ── Serial / row ─────────────────────────────────────────────
    (r'^sr\.?\s?no\.?$|^s\.?\s?no\.?$|^sl\.?\s?no\.?$|^serial', 'sr_no'),

    # ── Images (checked early so they don't false-match text rules)
    (r'thumb\s*imp|thumb\s*print', 'photo'),
    (r'photograph|passport\s*size|photo|pic|picture|image', 'photo'),
    (r'signature|sign', 'signature'),
    (r'qr\s*code|barcode|rfid|nfc|smart\s*chip|hologram', 'qr_barcode'),

    # ── Names ────────────────────────────────────────────────────
    (r'husband|wife|spouse', 'spouse_name'),
    (r'guardian', 'guardian_name'),
    (r'father|mother|parent', 'parent_name'),
    (r'full\s*name|first\s*name|middle\s*name|last\s*name|surname'
     r'|student\s*name|emp\s*name|employee\s*name|^name$', 'full_name'),
    (r'reporting\s*manager|manager\s*name', 'reporting_manager'),
    (r'emergency\s*contact\s*person', 'full_name'),

    # ── Dates ────────────────────────────────────────────────────
    (r'dob|date\s*of\s*birth|birth\s*date', 'date'),
    (r'date\s*of\s*joining|joining\s*date|doj', 'date'),
    (r'valid\s*from|valid\s*till|validity|expiry', 'validity_period'),
    (r'\bdate\b', 'date'),

    # ── Age ──────────────────────────────────────────────────────
    (r'^age$', 'age'),

    # ── Gender ───────────────────────────────────────────────────
    (r'^gender$|^sex$', 'gender'),

    # ── Blood Group ──────────────────────────────────────────────
    (r'blood\s*gr|blood\s*group|^bg$|^bgroup$|^b\.?g\.?$', 'blood_group'),

    # ── Nationality / Religion / Caste ───────────────────────────
    (r'nationality', 'nationality'),
    (r'religion', 'religion'),
    (r'caste|category|gen.*obc.*sc|sc.*st', 'caste_category'),
    (r'marital|married|unmarried', 'marital_status'),

    # ── Aadhaar (multiple spellings) ─────────────────────────────
    (r'aadh?a+r|uidai|uid\s*no', 'aadhaar'),

    # ── PAN ──────────────────────────────────────────────────────
    (r'^pan$|pan\s*no|pan\s*number|pan\s*card', 'pan'),

    # ── Voter ID ─────────────────────────────────────────────────
    (r'voter\s*id|epic\s*no', 'voter_id'),

    # ── Driving License ──────────────────────────────────────────
    (r'driving\s*li[cs]en[cs]e|dl\s*no|dl\s*number', 'driving_license'),

    # ── Passport ─────────────────────────────────────────────────
    (r'passport\s*no|passport\s*number', 'passport_number'),

    # ── Ration Card ──────────────────────────────────────────────
    (r'ration\s*card', 'id_number'),

    # ── Health IDs ───────────────────────────────────────────────
    (r'abha|ayushman|health\s*id', 'health_id'),

    # ── ESIC / PF / UAN ─────────────────────────────────────────
    (r'esic|pf\s*no|uan\s*no|uan\s*number|epf', 'id_number'),

    # ── Generic ID numbers ───────────────────────────────────────
    (r'id\s*card\s*no|id\s*no|idno', 'id_number'),
    (r'roll\s*no|roll\s*number|^roll$', 'id_number'),
    (r'emp\s*code|employee\s*code|emp\s*id', 'id_number'),
    (r'admission\s*no|adm\s*no', 'id_number'),
    (r'reg\s*no|registration|enrol', 'id_number'),
    (r'service\s*no|service\s*number', 'service_number'),

    # ── Misc short (BEFORE phone to prevent false matches) ─────
    (r'hostel|room\s*no', 'hostel_room'),
    (r'bus\s*route', 'bus_route'),
    (r'library\s*card|library\s*no', 'library_card'),
    (r'lab\s*access|lab\s*code', 'lab_access'),

    # ── Phone / Mobile ───────────────────────────────────────────
    (r'mobile|phone|cell\b|tel\b|whatsapp|^mob\b'
     r'|emergency\s*contact\s*number|office\s*contact'
     r'|alternate\s*mobile|alt\s*mobile|contact\s*no|contact\s*number', 'mobile'),

    # ── Email ────────────────────────────────────────────────────
    (r'email|e\s*mail', 'email'),

    # ── Address ──────────────────────────────────────────────────
    (r'permanent\s*addr|current\s*addr|present\s*addr|^address$|addr', 'address'),
    (r'^city$|^town$', 'city'),
    (r'^district$', 'district'),
    (r'^state$|^province$', 'state'),
    (r'pin\s*code|^pin$|^zip$|postal\s*code', 'pincode'),
    (r'^country$', 'country'),

    # ── Organisation / Education ─────────────────────────────────
    (r'^branch$|branch\s*name', 'branch'),
    (r'^department$|^dept$|department\s*name', 'department'),
    (r'^designation$|^desig$', 'designation'),
    (r'course\s*name|^course$|course\s*duration', 'course'),
    (r'^class$|^section$|^sec$|^div$|^division$', 'class_section'),
    (r'^batch$|^batch\s*no', 'batch'),
    (r'^semester$|^sem$', 'semester'),
    (r'^stream$|science.*commerce.*arts', 'stream'),

    # ── Employment ───────────────────────────────────────────────
    (r'emp\s*type|employee\s*type|permanent.*contract|contract.*intern', 'employee_type'),
    (r'grade\s*level|^grade$|pay\s*grade', 'grade_level'),
    (r'shift|timing', 'shift_timing'),
    (r'access\s*level|security\s*level', 'access_level'),
    (r'work\s*location|office\s*location|posting\s*location|posted\s*at', 'posting_location'),
    (r'emp\s*status|employee\s*status|^status$', 'employee_status'),

    # ── Defence / Police ─────────────────────────────────────────
    (r'^rank$', 'rank'),

    # ── Medical ──────────────────────────────────────────────────
    (r'allerg', 'allergies'),
    (r'medical\s*cond|medical\s*history|health\s*cond', 'medical_condition'),
    (r'disabilit', 'disability'),

    (r'year\s*of\s*joining', 'date'),
]

# Compile patterns once
_COMPILED_ALIASES: List[Tuple[re.Pattern, str]] = [
    (re.compile(pattern, re.IGNORECASE), category)
    for pattern, category in FIELD_ALIASES
]


# ─────────────────────────────────────────────────────────────────────
# 3. Public API
# ─────────────────────────────────────────────────────────────────────

def _normalise_name(name: str) -> str:
    """Normalise a field/column name for matching.

    Strips whitespace, underscores, dots, apostrophes, hyphens;
    collapses to single-spaced lowercase.
    """
    s = name.strip()
    # Replace separators with space
    s = re.sub(r"[_.\-'\"()/]+", ' ', s)
    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip().lower()
    return s


def classify_column(field_name: str, field_type: str = '') -> str:
    """
    Classify a column heading into a canonical category.

    Args:
        field_name: The column heading (e.g. "Father's Name", "BG", "Mob No")
        field_type: Optional explicit field type from table config
                    (e.g. 'photo', 'signature', 'date', 'textarea')

    Returns:
        Canonical category string (e.g. 'full_name', 'blood_group', 'mobile')
    """
    ft = (field_type or '').lower().strip()

    # Explicit type shortcuts
    if ft in ('photo', 'image', 'mother_photo', 'father_photo'):
        return 'photo'
    if ft == 'signature':
        return 'signature'
    if ft in ('barcode', 'qr_code', 'qr'):
        return 'qr_barcode'
    if ft == 'date':
        return 'date'
    if ft == 'textarea':
        return 'address'

    norm = _normalise_name(field_name)
    if not norm:
        return '_default'

    for pattern, category in _COMPILED_ALIASES:
        if pattern.search(norm):
            return category

    return '_default'


def get_column_spec(field_name: str, field_type: str = '') -> ColumnSpec:
    """
    Get the full ColumnSpec for a field.

    Args:
        field_name: Column heading
        field_type: Optional explicit type

    Returns:
        ColumnSpec dataclass with all sizing / behaviour info
    """
    category = classify_column(field_name, field_type)
    return _SPECS.get(category, _SPECS['_default'])


def get_pdf_width_percent(field_name: str, field_type: str = '') -> Tuple[float, float]:
    """Return (min_pct, max_pct) for PDF column width."""
    spec = get_column_spec(field_name, field_type)
    return spec.pdf_min_pct, spec.pdf_max_pct


def get_word_width_cm(field_name: str, field_type: str = '') -> Tuple[float, float]:
    """Return (min_cm, max_cm) for Word column width."""
    spec = get_column_spec(field_name, field_type)
    return spec.word_min_cm, spec.word_max_cm


def get_html_classes(field_name: str, field_type: str = '') -> Tuple[str, str]:
    """Return (th_class, td_class) for HTML table columns."""
    spec = get_column_spec(field_name, field_type)
    return spec.html_th_class, spec.html_td_class


def is_nowrap_column(field_name: str, field_type: str = '') -> bool:
    """Check if a column should not wrap its content."""
    return not get_column_spec(field_name, field_type).wrap


def get_column_align(field_name: str, field_type: str = '') -> str:
    """Return 'left', 'center', or 'right'."""
    return get_column_spec(field_name, field_type).align
