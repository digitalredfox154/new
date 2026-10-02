"""Package the qualified-leads Vite build as an immutable /test/ release."""
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

prototype = Path("prototypes/qualified-leads-motion-v1/dist")
out = Path("dist")
legal_source = Path("site")
sha = os.environ.get("GITHUB_SHA", "0" * 40)
branch = os.environ.get("GITHUB_REF_NAME", "samai-qualified-leads-v12")

assert re.fullmatch(r"[0-9a-f]{40}", sha), "GITHUB_SHA must be an exact commit"
assert (prototype / "index.html").is_file(), "Build the qualified-leads prototype before packaging"
if out.exists():
    shutil.rmtree(out)
shutil.copytree(prototype, out)

html_path = out / "index.html"
html = html_path.read_text(encoding="utf-8")
release = "12-ci-" + sha[:12]
html, marker_count = re.subn(
    r'(<meta name="samai-build" content=")[^"]+',
    lambda match: match[1] + release,
    html,
    count=1,
)
assert marker_count == 1, "Missing or ambiguous SAMAI build marker"
assert 'content="noindex,nofollow"' in html
assert 'id="contact-form"' in html and 'id="privacy-consent"' in html
assert "Квалифицированные лиды" in html and "по вашим критериям" in html
assert "агентский договор" not in html.lower()
assert "напрямую поставщику" not in html.lower()
assert 'src="/assets/' not in html and 'href="/assets/' not in html
assert "fonts.googleapis.com" not in html and "fonts.gstatic.com" not in html
html_path.write_text(html, encoding="utf-8")

for page in ["privacy.html", "consent.html"]:
    legal = (legal_source / page).read_text(encoding="utf-8")
    assert "noindex,nofollow" in legal
    (out / page).write_text(legal, encoding="utf-8")

allowed_suffixes = {".html", ".css", ".js", ".png", ".webp", ".svg"}
files = []
for file in sorted(out.rglob("*")):
    if not file.is_file():
        continue
    assert not file.is_symlink(), file
    assert file.suffix in allowed_suffixes, file
    raw = file.read_bytes()
    files.append({
        "path": file.relative_to(out).as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
    })

manifest = {
    "schema": 1,
    "release": release,
    "sourceSha": sha,
    "repository": "digitalredfox154/new",
    "sourceBranch": branch,
    "runId": int(os.environ.get("GITHUB_RUN_ID", "0")),
    "runAttempt": int(os.environ.get("GITHUB_RUN_ATTEMPT", "1")),
    "target": "/test/",
    "files": files,
}
(out / "release.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps({
    "release": release,
    "branch": branch,
    "files": len(files),
    "htmlBytes": html_path.stat().st_size,
}, ensure_ascii=False))
