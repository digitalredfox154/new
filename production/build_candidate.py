#!/usr/bin/env python3
"""Build a production-root candidate from an exact tested staging artifact.

This script never deploys. It fails closed until legal/device approvals are supplied.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, sys
from pathlib import Path

DRAFT_NOTICE = 'подлежит итоговой юридической проверке'

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='dist')
    parser.add_argument('--output', default='dist-production')
    args = parser.parse_args()
    source, output = Path(args.source), Path(args.output)
    blockers = []
    for name in ['index.html', 'privacy.html', 'consent.html', 'release.json']:
        if not (source / name).is_file(): blockers.append(f'missing:{name}')
    if blockers:
        print(json.dumps({'ready': False, 'blockers': blockers}, ensure_ascii=False)); return 2
    release = json.loads((source / 'release.json').read_text('utf-8'))
    source_sha = str(release.get('sourceSha', ''))
    if not re.fullmatch(r'[0-9a-f]{40}', source_sha): blockers.append('invalid-source-sha')
    if release.get('target') != '/test/': blockers.append('source-is-not-tested-staging-release')
    if os.environ.get('SAMAI_LEGAL_APPROVED') != source_sha: blockers.append('legal-approval-missing-for-exact-sha')
    if os.environ.get('SAMAI_DEVICE_QA_APPROVED') != source_sha: blockers.append('physical-device-qa-missing-for-exact-sha')
    legal_text = ((source / 'privacy.html').read_text('utf-8') + (source / 'consent.html').read_text('utf-8')).lower()
    if DRAFT_NOTICE in legal_text: blockers.append('legal-pages-still-marked-draft')
    if blockers:
        print(json.dumps({'ready': False, 'sourceSha': source_sha, 'blockers': blockers}, ensure_ascii=False, indent=2)); return 2
    if output.exists(): shutil.rmtree(output)
    shutil.copytree(source, output)
    index = (output / 'index.html').read_text('utf-8')
    index = index.replace('content="noindex,nofollow" name="robots"', 'content="index,follow,max-image-preview:large" name="robots"', 1)
    index = index.replace('https://samaiconsulting.ru/test/assets/', 'https://samaiconsulting.ru/assets/')
    index = re.sub(r'07-ci-[0-9a-f]{12}', '07-prod-' + source_sha[:12], index, count=1)
    if 'noindex,nofollow' in index: raise RuntimeError('index page is still noindex')
    (output / 'index.html').write_text(index, encoding='utf-8')
    manifest = {'schema': 1, 'release': '07-prod-' + source_sha[:12], 'sourceSha': source_sha, 'target': '/', 'files': []}
    for file in sorted(output.rglob('*')):
        if file.is_file() and file.name not in {'release.json', 'production-release.json'}:
            raw = file.read_bytes(); manifest['files'].append({'path': file.relative_to(output).as_posix(), 'bytes': len(raw), 'sha256': sha256(raw)})
    (output / 'production-release.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ready': True, 'release': manifest['release'], 'files': len(manifest['files'])}, ensure_ascii=False))
    return 0

if __name__ == '__main__': sys.exit(main())
