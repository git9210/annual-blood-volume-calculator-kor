#!/usr/bin/env python3
"""Generate the app's geometric SVG/vector icons. No external image assets.

The droplet is drawn with the Bezier coordinates below; its two horizontal
bars represent a calculation. The settings icon uses eight radial teeth;
the refresh icon uses two semicircles. All coordinates are defined here.
Only Python's standard library is needed; no fonts or downloaded images.
"""
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DROP = 'M96 32 C83 52 53 82 53 111 C53 137 71 157 96 157 C121 157 139 137 139 111 C139 82 109 52 96 32 Z'
BARS = 'M79 104 H113 M79 122 H113'
BRAND = '#184d44'
LIGHT = '#dce6bf'
(ROOT/'assets/icon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="46" fill="{BRAND}"/><path d="{DROP}" fill="{LIGHT}"/><path d="{BARS}" fill="none" stroke="{BRAND}" stroke-width="9" stroke-linecap="round"/></svg>\n')
(ROOT/'res/drawable/launcher_foreground.xml').write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="192" android:viewportHeight="192">
    <group android:scaleX="0.75" android:scaleY="0.75" android:translateX="24" android:translateY="24">
        <path android:fillColor="{LIGHT}" android:pathData="{DROP}" />
        <path android:pathData="{BARS}" android:strokeColor="{BRAND}" android:strokeWidth="9" android:strokeLineCap="round" />
    </group>
</vector>
''')
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
print('Generated geometric brand, settings and refresh vector assets.')
