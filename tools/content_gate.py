"""Russian landing-copy gate based on Hemingway's clarity principles."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path


class CopyParser(HTMLParser):
    BLOCKS = {'h1', 'h2', 'h3', 'h4', 'p', 'li', 'dd', 'dt', 'small', 'summary', 'button', 'label', 'legend'}
    SKIP = {'script', 'style', 'svg', 'noscript'}

    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.stack = []
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip_depth += 1
        if not self.skip_depth and tag in self.BLOCKS:
            self.stack.append([tag, []])

    def handle_endtag(self, tag):
        if self.skip_depth:
            if tag in self.SKIP:
                self.skip_depth -= 1
            return
        if self.stack and self.stack[-1][0] == tag:
            _, parts = self.stack.pop()
            text = re.sub(r'\s+', ' ', ''.join(parts)).strip()
            if text:
                self.blocks.append(text)

    def handle_data(self, data):
        if not self.skip_depth:
            for _, parts in self.stack:
                parts.append(data)


html = Path('dist/index.html').read_text(encoding='utf-8')
parser = CopyParser()
parser.feed(html)
blocks = parser.blocks
copy = '\n'.join(blocks)

# These phrases are either generic AI filler or bureaucratic abstractions that
# have clearer, shorter alternatives in customer-facing copy.
banned = [
    r'в современном мире',
    r'индивидуальн\w* подход',
    r'комплексн\w* решени',
    r'инновационн\w* решени',
    r'маркетингов\w* функци',
    r'контур работ',
    r'рабочий контур',
    r'в согласованных полномочиях',
    r'следующий шаг на основе данных',
    r'предусмотренн\w* в следующем формате',
]
sources = [copy]
for path in ['site/v04.js', 'site/v05.js', 'site/v08.js']:
    sources.append(Path(path).read_text(encoding='utf-8'))
combined = '\n'.join(sources).lower()
banned_hits = [pattern for pattern in banned if re.search(pattern, combined)]

sentences = []
for block in blocks:
    for sentence in re.split(r'(?<=[.!?])\s+', block):
        words = re.findall(r'[A-Za-zА-Яа-яЁё0-9]+(?:[-–][A-Za-zА-Яа-яЁё0-9]+)*', sentence)
        if words:
            sentences.append({'text': sentence, 'words': len(words)})
long_sentences = [item for item in sentences if item['words'] > 18]

word_count = len(re.findall(r'[A-Za-zА-Яа-яЁё0-9]+(?:[-–][A-Za-zА-Яа-яЁё0-9]+)*', copy))
report = {
    'blocks': len(blocks),
    'sentences': len(sentences),
    'words': word_count,
    'maxSentenceWords': max((item['words'] for item in sentences), default=0),
    'longSentences': long_sentences,
    'bannedPhraseHits': banned_hits,
}
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/content-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
assert not banned_hits, f'AI/corporate filler remains: {banned_hits}'
assert not long_sentences, f'Sentences over 18 words: {long_sentences}'

