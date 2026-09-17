"""Build a tested /test/ release from source using content-addressed resources."""
import hashlib, json, os, re, shutil
from pathlib import Path

src, out = Path('site'), Path('dist')
sha = os.environ.get('GITHUB_SHA', '0' * 40)
branch = os.environ.get('GITHUB_REF_NAME', 'samai-landing')
assert re.fullmatch(r'[0-9a-f]{40}', sha)
if out.exists(): shutil.rmtree(out)
(out / 'assets').mkdir(parents=True)

asset_suffixes = {'.css', '.js', '.png', '.webp', '.svg'}
mapping = {}
for file in sorted(src.rglob('*')):
    if not file.is_file() or file.suffix == '.html': continue
    assert not file.is_symlink() and file.suffix in asset_suffixes, file
    raw = file.read_bytes()
    if file.name == 'app.js':
        text = raw.decode('utf-8')
        text, removed = re.subn(
            r"\n  // Load the chosen Cyrillic-capable family non-blockingly\.[\s\S]*?document\.head\.append\(fontLink\);",
            "", text, count=1,
        )
        assert removed == 1, 'Expected external font loader was not found'
        raw = text.encode('utf-8')
    digest = hashlib.sha256(raw).hexdigest()
    target = 'assets/' + file.stem + '.' + digest[:16] + file.suffix
    (out / target).write_bytes(raw)
    mapping[file.relative_to(src).as_posix()] = target

html = (src / 'index.html').read_text(encoding='utf-8')
assert 'noindex,nofollow' in html and 'contact-form' in html
assert 'data:image/png;base64' not in html
assert html.count('Демонстрация формы · данные не отправляются') == 1
assert html.count('Предпросмотр · Форма без отправки') == 1

head_add = '''
<meta name="referrer" content="strict-origin-when-cross-origin"/><meta name="theme-color" content="#000000"/>
<link rel="canonical" href="https://samaiconsulting.ru/"/>
<link rel="icon" type="image/png" href="assets/logo-f28c8f1a274e05ce.png"/>
<link rel="apple-touch-icon" href="assets/logo-f28c8f1a274e05ce.png"/>
<meta property="og:type" content="website"/><meta property="og:locale" content="ru_RU"/>
<meta property="og:title" content="Маркетинг. В одних руках. — SAMAI Consulting"/>
<meta property="og:description" content="SAMAI берёт на себя план маркетинга, задачи и координацию подрядчиков для B2B-компаний и экспертных проектов."/>
<meta property="og:url" content="https://samaiconsulting.ru/"/><meta property="og:image" content="https://samaiconsulting.ru/test/assets/logo-f28c8f1a274e05ce.png"/>
<meta name="twitter:card" content="summary"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfessionalService","name":"Samai Consulting","legalName":"Индивидуальный предприниматель Самай Сергей Леонидович","url":"https://samaiconsulting.ru/","address":{"@type":"PostalAddress","postalCode":"420099","addressCountry":"RU","addressRegion":"Республика Татарстан","addressLocality":"Казань","streetAddress":"ул. Березовая (Щербаково), д. 9"}}</script>
<link rel="stylesheet" href="v05.css"><link rel="stylesheet" href="v06.css">'''
html = html.replace('</head>', head_add + '\n</head>', 1)
html = html.replace('</body>', '<script src="v05.js"></script>\n</body>', 1)
html = html.replace('Демонстрация формы · данные не отправляются', 'Оставьте контакт. Ответит руководитель проекта.')

button = '<button class="button button-light form-submit" disabled="" type="submit">'
assert html.count(button) == 1
form_extra = '''<div class="hp-field" aria-hidden="true"><label for="website">Не заполняйте это поле</label><input id="website" name="website" tabindex="-1" autocomplete="off"/></div><div class="consent-field"><label><input id="privacy-consent" name="privacy_consent" type="checkbox" required/><span>Согласен на <a href="consent.html" target="_blank" rel="noopener">обработку персональных данных</a> и ознакомлен с <a href="privacy.html" target="_blank" rel="noopener">Политикой</a>.</span></label><p class="consent-error" id="consent-error" hidden></p></div>'''
html = html.replace(button, form_extra + button, 1)
old_fine = 'В этом прототипе кнопка только проверяет заполнение. Заявка не отправляется и не сохраняется. Контакт получателя и документы формы будут добавлены перед запуском.'
assert html.count(old_fine) == 1
html = html.replace(old_fine, 'Используем данные только для ответа на заявку. Имя и контакт не попадают в аналитику.')
html = html.replace('Для проверки формы включите JavaScript. Отправка в прототипе не подключена.', 'Для отправки заявки через сайт необходимо включить JavaScript.')
html = html.replace('Предпросмотр · Форма без отправки', '<span class="legal-links"><a data-legal href="privacy.html">Политика данных</a><a data-legal href="consent.html">Согласие</a></span>')

release = '07-ci-' + sha[:12]
html, count = re.subn(r'(<meta name="samai-build" content=")[^"]+', lambda m: m[1] + release, html)
assert count == 1, 'Missing or ambiguous build marker'
for before, after in sorted(mapping.items(), key=lambda p: -len(p[0])):
    html = html.replace('"' + before + '"', '"' + after + '"')
    html = html.replace('/test/' + before, '/test/' + after)
assert 'fonts.googleapis.com' not in html
(out / 'index.html').write_text(html, encoding='utf-8')

for page in ['privacy.html', 'consent.html']:
    legal = (src / page).read_text(encoding='utf-8')
    assert 'noindex,nofollow' in legal
    (out / page).write_text(legal, encoding='utf-8')

files = []
for f in sorted(out.rglob('*')):
    if f.is_file():
        raw = f.read_bytes()
        files.append({'path': f.relative_to(out).as_posix(), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
manifest = {'schema': 1, 'release': release, 'sourceSha': sha, 'repository': 'digitalredfox154/new', 'sourceBranch': branch, 'runId': int(os.environ.get('GITHUB_RUN_ID', '0')), 'runAttempt': int(os.environ.get('GITHUB_RUN_ATTEMPT', '1')), 'target': '/test/', 'files': files}
(out / 'release.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'release': release, 'branch': branch, 'files': len(files), 'htmlBytes': (out / 'index.html').stat().st_size}))
