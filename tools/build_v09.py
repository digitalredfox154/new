"""Build v09 on top of the verified v08 compiler and add the polish layer."""
import hashlib, json, runpy
from pathlib import Path

runpy.run_path('tools/build_v08.py', run_name='__main__')
out=Path('dist')
index=out/'index.html'
html=index.read_text(encoding='utf-8')
css=list((out/'assets').glob('v09.*.css'))
assert len(css)==1, css
css_path='assets/'+css[0].name
assert css_path not in html
html=html.replace('</head>',f'<link rel="stylesheet" href="{css_path}">\n</head>',1)
assert '08-ci-' in html
html=html.replace('08-ci-','09-ci-',1)
index.write_text(html,encoding='utf-8')

manifest=json.loads((out/'release.json').read_text(encoding='utf-8'))
manifest['release']='09-ci-'+manifest['sourceSha'][:12]
files=[]
for f in sorted(out.rglob('*')):
    if f.is_file() and f.name!='release.json':
        raw=f.read_bytes()
        files.append({'path':f.relative_to(out).as_posix(),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
manifest['files']=files
(out/'release.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'release':manifest['release'],'files':len(files),'v09Css':css_path}))
