from __future__ import annotations

import os
import re

BLOCKED_UPLOAD_EXTENSIONS = {
    '.ade',
    '.adp',
    '.app',
    '.asp',
    '.aspx',
    '.bas',
    '.bat',
    '.cer',
    '.chm',
    '.cmd',
    '.com',
    '.cpl',
    '.crt',
    '.dll',
    '.exe',
    '.hta',
    '.htm',
    '.html',
    '.inf',
    '.ins',
    '.isp',
    '.jar',
    '.jse',
    '.jsp',
    '.ksh',
    '.lnk',
    '.mad',
    '.maf',
    '.mag',
    '.mam',
    '.maq',
    '.mar',
    '.mas',
    '.mat',
    '.mau',
    '.mav',
    '.maw',
    '.mda',
    '.mdb',
    '.mde',
    '.mdt',
    '.mdw',
    '.mdz',
    '.msc',
    '.msi',
    '.msp',
    '.mst',
    '.ops',
    '.pcd',
    '.php',
    '.pif',
    '.pl',
    '.prf',
    '.prg',
    '.ps1',
    '.ps1xml',
    '.ps2',
    '.ps2xml',
    '.psc1',
    '.psc2',
    '.py',
    '.rb',
    '.reg',
    '.scf',
    '.scr',
    '.sct',
    '.sh',
    '.svg',
    '.url',
    '.vb',
    '.vbe',
    '.vbs',
    '.wsc',
    '.wsf',
    '.wsh',
}

_CONTROL_CHARS_RE = re.compile(r'[\x00-\x1f\x7f]')


def is_blocked_upload_name(raw_name: str) -> bool:
    filename = os.path.basename(str(raw_name or '').strip())
    _, ext = os.path.splitext(filename.lower())
    return ext in BLOCKED_UPLOAD_EXTENSIONS


def safe_download_filename(raw_name: str, fallback: str) -> str:
    filename = os.path.basename(str(raw_name or '').strip())
    filename = _CONTROL_CHARS_RE.sub('', filename)
    filename = filename.replace('"', '').replace('\\', '').replace('/', '')
    if not filename:
        return fallback
    return filename[:255]
