"""Read font name-table evidence, never rewrite font binaries.

Audit-only dependencies: fonttools==4.59.2 and brotli==1.1.0.
Usage: python scripts/release-font-audit.py <font-directory> [<dependency-font-directory>]
Output is evidence, not a declaration of rights or licence compatibility.
"""
import hashlib
import json
from pathlib import Path
import sys
from fontTools.ttLib import TTFont

font_directory = Path(sys.argv[1])
comparison = Path(sys.argv[2]) if len(sys.argv) > 2 else None
rows = []
for file in sorted(font_directory.glob('*.woff2')):
    with TTFont(file) as font:
        names = {}
        for record in font['name'].names:
            if record.nameID in (0, 1, 3, 5, 7, 8, 9, 11, 12, 13, 14):
                names.setdefault(str(record.nameID), set()).add(record.toUnicode())
        data = file.read_bytes()
        row = {'file': file.as_posix(), 'sha256': hashlib.sha256(data).hexdigest(),
               'names': {key: sorted(values) for key, values in names.items()}}
        if comparison is not None:
            other = comparison / file.name
            row['matchesDependencyFile'] = other.exists() and other.read_bytes() == data
        rows.append(row)
if not rows:
    raise ValueError('No WOFF2 files found; refusing an empty audit')
print(json.dumps(rows, ensure_ascii=True, indent=2))
