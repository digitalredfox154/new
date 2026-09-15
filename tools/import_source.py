"""One-time import of the user's existing public test page. Not used after import."""
import base64, hashlib, re, urllib.request
from pathlib import Path
BASE = 'https://samaiconsulting.ru/test/_ci_source_v04_20260916/'
HASHES = {'index.html': '5b959c2f2b59139c0b5a589748f0fb8adca5bc0bc297394138b5d9505f492e98', 'v04.css': '541ffc155ef1fc7f99a0bfe051f21bccd86766f36aba3a49d2e82d9d62abde29'}
root = Path('site')
assert not (root / 'index.html').exists(), 'Source is already imported'
root.mkdir(exist_ok=True)
data = {}
for name, digest in HASHES.items():
    with urllib.request.urlopen(BASE + name, timeout=30) as r:
        value = r.read(2_000_001)
    assert len(value) <= 2_000_000 and hashlib.sha256(value).hexdigest() == digest, name + ' snapshot mismatch'
    data[name] = value.decode('utf-8')
html = data['index.html']
assert 'Маркетинг.' in html and 'noindex' in html and 'В одних руках.' in html
assets = root / 'assets'
assets.mkdir(exist_ok=True)
def image(match):
    raw = base64.b64decode(match.group(1), validate=True)
    name = 'assets/logo-' + hashlib.sha256(raw).hexdigest()[:16] + '.png'
    (root / name).write_bytes(raw)
    return name
html, images = re.subn(r'data:image/png;base64,([A-Za-z0-9+/=]+)', image, html)
assert images >= 1
styles = re.findall(r'<style[^>]*>([\s\S]*?)</style>', html, re.I)
assert styles
(root / 'base.css').write_text('\n'.join(styles), encoding='utf-8')
html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.I)
apps = []
def script(match):
    attrs, code = match.group(1), match.group(2)
    if 'src=' in attrs:
        assert 'v04.js' in attrs, 'Unexpected external script'
        return ''
    if '__SAMAI_PROTOTYPE__' in code:
        apps.append(code)
    else:
        assert 'SamaiMotion' in code, 'Unexpected inline script'
    return ''
html = re.sub(r'<script([^>]*)>([\s\S]*?)</script>', script, html, flags=re.I)
assert len(apps) == 1
(root / 'app.js').write_text(apps[0], encoding='utf-8')
(root / 'v04.css').write_text(data['v04.css'], encoding='utf-8')
html = re.sub(r'<link\b[^>]*href="[^"]*v04\.css[^"]*"[^>]*>', '', html)
html = re.sub(r'(<meta name="samai-build" content=")[^"]+', r'\g<1>04-ci-source', html)
html = html.replace('</head>', '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="v04.css"></head>')
html = html.replace('</body>', '<script src="app.js"></script><script src="v04.js"></script></body>')
(root / 'index.html').write_text(html, encoding='utf-8')
print('Imported exact snapshot:', len(html.encode()), 'HTML bytes;', images, 'deduplicated image references')
