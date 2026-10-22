"""Export existing academic-pdf-bilingual jobs without retranslation or source edits.

The output intentionally excludes absolute paths and API/service configuration.
Use --pdf with the final, repaired bilingual PDF, never collect/ output.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def export_job(job, pdf, title='', author='', source_override=None):
    import pymupdf as fitz
    job, pdf = Path(job), Path(pdf)
    meta = read(job / 'manifest.json')
    if meta.get('pages'):
        raise ValueError('页码试样任务不能作为全文阅读包，请使用完整任务。')
    source = Path(source_override or meta['source'])
    if sha(source) != meta['source_sha256']:
        raise ValueError('原文哈希与任务不匹配。')
    with fitz.open(pdf) as dual, fitz.open(source) as original:
        if len(dual) != len(original):
            raise ValueError('双语文件页数与原文不一致。')
        for i in range(len(dual)):
            a, b = original[i].rect, dual[i].rect
            if abs(a.width * 2 - b.width) > .1 or abs(a.height - b.height) > .1:
                raise ValueError(f'第 {i+1} 页不是该技能的左右对照版式。')
            # Bind the job to the actual English half, not merely a matching page count.
            left = dual[i].get_pixmap(matrix=fitz.Matrix(.5, .5), clip=a, alpha=False)
            expected = original[i].get_pixmap(matrix=fitz.Matrix(.5, .5), alpha=False)
            if (left.width, left.height, left.samples) != (expected.width, expected.height, expected.samples):
                raise ValueError(f'第 {i+1} 页左侧与任务原文不匹配。')
        pages = len(dual)
    translations = read(job / 'translations.json')
    segments = []
    seen = set()
    for batch in sorted((job / 'batches').glob('*.json')):
        for item in read(batch):
            if item['id'] in seen:
                continue
            seen.add(item['id'])
            entry = translations.get(item['id'])
            if entry is None:
                raise ValueError('翻译缺失：' + item['id'])
            keep = isinstance(entry, dict) and entry.get('keep') is True
            zh = entry if isinstance(entry, str) else (item['source'] if keep else entry.get('zh', ''))
            en = item['source']
            for formula in item.get('formula_context', []):
                token = formula.get('placeholder', '')
                chars = formula.get('formula_chars', '')
                if token and chars:
                    en = en.replace(token, chars)
                    zh = zh.replace(token, chars)
            # Unresolved formulas are never silently guessed or omitted.
            en = re.sub(r'\{\s*v\s*\d+\s*\}', '［公式请查看 PDF］', en)
            zh = re.sub(r'\{\s*v\s*\d+\s*\}', '［公式请查看 PDF］', zh)
            segments.append({'id': item['id'], 'page': item.get('page_in_job'), 'source': en, 'zh': zh,
                             'keep': keep, 'reason': entry.get('reason', '') if isinstance(entry, dict) else '',
                             'hasFormula': bool(item.get('formula_context'))})
    glossary = read(job / 'glossary.json') if (job / 'glossary.json').exists() else {}
    if not isinstance(glossary, dict):
        glossary = {}
    glossary = {str(k): v for k, v in glossary.items() if isinstance(v, str)}
    verification = read(job / 'verification.json') if (job / 'verification.json').exists() else {}
    return {'format': 'yuejian-babeldoc-v1', 'pdfSha256': sha(pdf), 'sourceSha256': meta['source_sha256'],
            'title': title or source.stem, 'titleEn': next((s['source'] for s in segments if len(s['source']) > 25), source.stem),
            'author': author, 'engine': 'BabelDOC ' + meta.get('babeldoc', ''), 'pageCount': pages,
            'segments': segments, 'glossary': glossary, 'review': verification.get('visual_review', 'pending'),
            'note': '段落来自翻译任务的去重片段与译文词典，不是完整 PDF 转写；图表、脚注、重复段落及后期排版修复请以最终 PDF 为准。公式原始字符仅作辅助核对。'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--source', help='原文移动后的实际路径；仍会校验原文哈希')
    parser.add_argument('--title', default='')
    parser.add_argument('--author', default='')
    args = parser.parse_args()
    result = export_job(args.job, args.pdf, args.title, args.author, args.source)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Exported {len(result["segments"])} segments, {result["pageCount"]} pages to {output}')
