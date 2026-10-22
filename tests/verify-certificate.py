#!/usr/bin/env python3
"""Check an explicitly supplied PDF against both PDFium and Poppler; never bundle it.

Requires JDK, pypdfium2 and pdftotext on the developer computer, not in the APK.
Usage: python3 tests/verify-certificate.py /path/to/certificate.pdf [YYYY-MM-DD]
"""
from pathlib import Path
import collections
import json
import re
import subprocess
import sys
import tempfile
import time
import pypdfium2

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
started = time.perf_counter()
with tempfile.TemporaryDirectory(prefix='certificate-check-') as directory:
    temporary = Path(directory)
    subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-d', str(temporary),
                    str(root / 'src/kr/bloodnote/app/CertificateParser.java'), str(root / 'tests/CertificateParserTest.java')], check=True)
    with pypdfium2.PdfDocument(source) as document:
        pages = []
        for i in range(len(document)):
            page = document[i]
            textpage = page.get_textpage()
            try:
                pages.append(textpage.get_text_range())
            finally:
                textpage.close()
                page.close()
    input_path = temporary / 'pages.txt'
    input_path.write_text('\f'.join(pages), encoding='utf-8')
    parsed = json.loads(subprocess.check_output(['java', '-cp', str(temporary), 'kr.bloodnote.app.CertificateParserTest', str(input_path)], text=True))
    layout = subprocess.check_output(['pdftotext', '-layout', str(source), '-'], text=True)
    independent = re.findall(r'^\s*\d+\s+\d{2}-\d{2}-\d{6}\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s+.+$', layout, re.M)
    assert len(independent) == parsed['expected'] == len(parsed['rows'])
    assert [(r['sourceType'], r['date']) for r in parsed['rows']] == independent
    assert all(set(row) == {'date', 'type', 'sourceType', 'page'} for row in parsed['rows'])
    assert len({r['date'] for r in parsed['rows']}) == len(parsed['rows'])
    # Check the complete native -> JavaScript validation/merge boundary, not extraction alone.
    command = ['node', str(root / 'tests/verify-certificate-review.mjs')]
    if len(sys.argv) > 2:
        command.append(sys.argv[2])
    review = json.loads(subprocess.check_output(command, input=json.dumps(parsed), text=True))
    print(json.dumps({'pages': parsed['pages'], 'records': len(parsed['rows']),
                      'types': dict(collections.Counter(r['type'] for r in parsed['rows'])),
                      'legacy_platelets': sum(r['sourceType']=='혈소판' for r in parsed['rows']),
                      'independent_extraction_agrees': True,
                      'javascript_review': review,
                      'desktop_check_seconds': round(time.perf_counter()-started, 2),
                      'android_device_tested': False}, ensure_ascii=False, indent=2))
