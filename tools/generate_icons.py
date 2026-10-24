#!/usr/bin/env python3
"""Generate only the geometric settings/refresh glyphs; preserve raster theme logos."""
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
points=[]
for tooth in range(8):
    for offset,radius in [(-18,7.4),(-9,9.4),(9,9.4),(18,7.4)]:
        angle=math.radians(tooth*45+offset)
        points.append(f'{12+radius*math.cos(angle):.3f},{12+radius*math.sin(angle):.3f}')
gear='<polygon points="'+' '.join(points)+'"></polygon><circle cx="12" cy="12" r="3.1"></circle>'
p=ROOT/'assets/index.html';s=p.read_text();start=s.index('<svg',s.index('id="settings-toggle"'));end=s.index('</svg>',start)
body=s.index('>',start)+1;s=s[:body]+gear+s[end:];p.write_text(s)
p=ROOT/'assets/app.mjs';s=p.read_text();start=s.index('<svg',s.index('class="holiday-refresh"'));end=s.index('</svg>',start)
body=s.index('>',start)+1
refresh='<path d="M5 11 A7 7 0 0 1 18 7 M18 3 V7 H14 M19 13 A7 7 0 0 1 6 17 M6 21 V17 H10"></path>'
s=s[:body]+refresh+s[end:];p.write_text(s)
print('Generated settings and refresh vectors; theme logos preserved.')
