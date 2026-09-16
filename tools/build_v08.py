"""Build v08 by reusing the verified v07 compiler, then linking v08 assets."""
import hashlib, json, runpy
from pathlib import Path

runpy.run_path('tools/build.py', run_name='__main__')
out=Path('dist')
index=out/'index.html'
html=index.read_text(encoding='utf-8')
css=list((out/'assets').glob('v08.*.css'))
js=list((out/'assets').glob('v08.*.js'))
assert len(css)==1 and len(js)==1, (css,js)
css_path='assets/'+css[0].name
js_path='assets/'+js[0].name
assert css_path not in html and js_path not in html
# Deliberate editorial contrast: keep the promise large, but reserve a clean
# architectural field for the physical SAMAI mark on desktop/tablet. Tablet
# widths need a smaller, higher object so the visual plate never crosses copy.
hero_fit='''<style>
@media(min-width:801px){.a-title-stage h1>span+span{font-size:.61em;letter-spacing:-.045em}}
@media(min-width:801px) and (max-width:1150px){.hero-a .brand-stage{width:282px;height:304px;top:-112px;right:-2px}.brand-assembly{inset:18px 28px 38px}}
</style>'''
html=html.replace('</head>',f'<link rel="stylesheet" href="{css_path}">\n{hero_fit}\n</head>',1)
html=html.replace('</body>',f'<script src="{js_path}"></script>\n</body>',1)
assert '07-ci-' in html
html=html.replace('07-ci-','08-ci-',1)
index.write_text(html,encoding='utf-8')
manifest=json.loads((out/'release.json').read_text(encoding='utf-8'))
manifest['release']='08-ci-'+manifest['sourceSha'][:12]
files=[]
for f in sorted(out.rglob('*')):
    if f.is_file() and f.name!='release.json':
        raw=f.read_bytes()
        files.append({'path':f.relative_to(out).as_posix(),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
manifest['files']=files
(out/'release.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'release':manifest['release'],'files':len(files),'v08Css':css_path,'v08Js':js_path}))
