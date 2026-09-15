"""Build the test-only static release using content-addressed resources."""
import hashlib, json, os, re, shutil
from pathlib import Path
src, out = Path('site'), Path('dist')
sha = os.environ.get('GITHUB_SHA', '0' * 40)
assert re.fullmatch('[0-9a-f]{40}', sha)
if out.exists(): shutil.rmtree(out)
(out / 'assets').mkdir(parents=True)
html = (src / 'index.html').read_text(encoding='utf-8')
assert 'noindex' in html and 'contact-form' in html
assert 'data:image/png;base64' not in html
mapping = {}
for file in sorted(src.rglob('*')):
    if not file.is_file() or file.name == 'index.html': continue
    assert not file.is_symlink() and file.suffix in {'.css', '.js', '.png', '.webp', '.svg'}
    raw = file.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    target = 'assets/' + file.stem + '.' + digest[:16] + file.suffix
    (out / target).write_bytes(raw)
    mapping[file.relative_to(src).as_posix()] = target
for before, after in sorted(mapping.items(), key=lambda p: -len(p[0])):
    html = html.replace('"' + before + '"', '"' + after + '"')
release = '04-ci-' + sha[:12]
html, count = re.subn(r'(<meta name="samai-build" content=")[^"]+', lambda m: m[1] + release, html)
assert count == 1, 'Missing or ambiguous build marker'
(out / 'index.html').write_text(html, encoding='utf-8')
files = []
for f in sorted(out.rglob('*')):
    if f.is_file():
        raw = f.read_bytes()
        files.append({'path': f.relative_to(out).as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
manifest = {'schema': 1, 'release': release, 'sourceSha': sha, 'repository': 'digitalredfox154/new', 'sourceBranch': 'samai-landing', 'runId': int(os.environ.get('GITHUB_RUN_ID', '0')), 'runAttempt': int(os.environ.get('GITHUB_RUN_ATTEMPT', '1')), 'target': '/test/', 'files': files}
(out / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'release': release, 'files': len(files), 'htmlBytes': (out / 'index.html').stat().st_size}))
