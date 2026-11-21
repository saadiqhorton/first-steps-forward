#!/usr/bin/env python3
"""Compare saturation and brightness across 4x4 cells using ImageMagick."""
import re
import subprocess
import sys

def cells(path):
    # ImageMagick's resize averages each region; HSV values are percentages.
    result = subprocess.run(['convert', path, '-resize', '4x4!', '-colorspace', 'HSV', '-depth', '8', 'txt:-'], check=True, capture_output=True, text=True)
    values = []
    for line in result.stdout.splitlines()[1:]:
        match = re.search(r'\((\d+),(\d+),(\d+)\)', line)
        if match:
            values.append(tuple(int(x) / 255 for x in match.groups()[1:]))
    if len(values) != 16:
        raise SystemExit('Could not read ImageMagick output')
    return values

if len(sys.argv) != 3:
    raise SystemExit('usage: python cook/harness/color-check.py REFERENCE RENDER')
a, b = cells(sys.argv[1]), cells(sys.argv[2])
for i, label in enumerate(('saturation', 'brightness')):
    deltas = [y[i] - x[i] for x, y in zip(a, b)]
    print(f'{label}: mean delta {sum(deltas) / len(deltas):+.3f}, worst cell {max(deltas, key=abs):+.3f}')
