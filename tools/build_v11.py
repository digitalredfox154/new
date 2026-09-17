"""Build v11 trust and conversion pass on top of the verified v10 compiler."""
import hashlib
import json
import runpy
from pathlib import Path

runpy.run_path('tools/build_v10.py', run_name='__main__')
out = Path('dist')
index = out / 'index.html'
html = index.read_text(encoding='utf-8')
assert '10-ci-' in html
html = html.replace('10-ci-', '11-ci-', 1)
index.write_text(html, encoding='utf-8')

manifest = json.loads((out / 'release.json').read_text(encoding='utf-8'))
manifest['release'] = '11-ci-' + manifest['sourceSha'][:12]
files = []
for file in sorted(out.rglob('*')):
    if file.is_file() and file.name != 'release.json':
        raw = file.read_bytes()
        files.append({
            'path': file.relative_to(out).as_posix(),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'bytes': len(raw),
        })
manifest['files'] = files
(out / 'release.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'release': manifest['release'], 'files': len(files)}))
