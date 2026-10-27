"""Export reviewed translation jobs without retranslation or source edits.

Use the final bilingual PDF. Legacy tracking and reverse-direction jobs are
supported explicitly; bundle source/zh always mean English/Chinese for v1.
"""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_items(job, tracking=None):
    if tracking:
        data = read(tracking)
        for page, record in enumerate(data['page'], 1):
            for item in record['paragraph']:
                source = item.get('input', '')
                if not source:
                    continue
                yield {'id': hashlib.sha256(source.encode()).hexdigest()[:16],
                       'page_in_job': page, 'source': source,
                       'formula_context': [p for p in item.get('placeholders', [])
                                           if p.get('type') == 'formula']}
        return
    for batch in sorted((job / 'batches').glob('*.json')):
        # Some jobs keep translated dictionaries beside the input batches.
        if batch.name.endswith('.zh.json'):
            continue
        data = read(batch)
        if not isinstance(data, list):
            raise ValueError(f'原文批次必须是片段列表：{batch.name}')
        yield from data


def normalize_glossary(value, source_language):
    terms = value.get('terms', value) if isinstance(value, dict) else {}
    if not isinstance(terms, dict):
        raise ValueError('术语表必须是词典。')
    result = {}
    for key, val in terms.items():
        if not isinstance(val, str) or key in ('direction', 'evidence_policy'):
            continue
        en, zh = (val, str(key)) if source_language == 'zh' else (str(key), val)
        if not en.strip() or not zh.strip():
            continue
        result[en] = result[en] + ' / ' + zh if en in result and zh != result[en] else zh
    return result


def restore_formulas(text, formulas):
    for item in formulas:
        token, chars = item.get('placeholder', ''), item.get('formula_chars', '')
        if token and chars:
            # Character codes without a decoded glyph cannot be safely guessed.
            if re.search(r'\(cid:\d+\)', chars) or '\ufffd' in chars:
                chars = '［公式请查看 PDF］'
            text = text.replace(token, chars)
    return re.sub(r'\{\s*v\s*\d+\s*\}', '［公式请查看 PDF］', text)


def verify_pdf(pdf, source, source_language):
    import pymupdf as fitz
    with fitz.open(pdf) as dual, fitz.open(source) as original:
        if len(dual) != len(original):
            raise ValueError('双语文件页数与原文不一致。')
        for i, page in enumerate(original):
            a, b = page.rect, dual[i].rect
            if abs(a.width * 2 - b.width) > .1 or abs(a.height - b.height) > .1:
                raise ValueError(f'第 {i+1} 页不是左右对照版式。')
            expected = page.get_pixmap(alpha=False)
            if source_language == 'en':
                actual = dual[i].get_pixmap(clip=a, alpha=False)
            else:
                # BabelDOC assemble places the original in fzFrm1 on the right.
                # Normalize a memory-only copy, just as the translation workflow
                # does: fractional point offsets otherwise change antialiasing.
                with fitz.open(stream=dual.tobytes(), filetype='pdf') as normalized:
                    np = normalized[i]
                    forms = [xo for xo in np.get_xobjects() if xo[2] == 0]
                    originals = [xo for xo in forms if xo[1] == 'fzFrm1']
                    if len(forms) != 2 or len(originals) != 1:
                        raise ValueError(f'第 {i+1} 页不支持原文右侧定位。')
                    kind, matrix = normalized.xref_get_key(originals[0][0], 'Matrix')
                    numbers = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', matrix)]
                    target = [1, 0, 0, 1, a.width, 0]
                    if kind != 'array' or len(numbers) != 6 or any(abs(x-y) > .01 for x, y in zip(numbers, target)):
                        raise ValueError(f'第 {i+1} 页原文右侧变换不符合预期。')
                    for xo in forms:
                        normalized.xref_set_key(xo[0], 'Matrix', '[1 0 0 1 0 0]' if xo[1] == 'fzFrm1' else '[1 0 0 1 -10000 0]')
                    np.set_mediabox(fitz.Rect(0, 0, a.width, a.height))
                    actual = normalized.reload_page(np).get_pixmap(alpha=False)
            if (actual.width, actual.height, actual.samples) != (expected.width, expected.height, expected.samples):
                raise ValueError(f'第 {i+1} 页原文侧与任务原文不匹配（72 DPI）。')
        return len(dual)


def render_cover(pdf, cache_dir=None):
    """The final PDF is authoritative: use page 1's Chinese/right half."""
    import pymupdf as fitz
    pdf_hash = sha(pdf)
    cache = Path(cache_dir) / '.cache' / 'cover.json' if cache_dir else None
    signature = hashlib.sha256(json.dumps([pdf_hash, fitz.VersionBind, 'zh-jpeg-480x1000-v1']).encode()).hexdigest()
    if cache:
        try:
            previous = read(cache) if cache.exists() else {}
        except (OSError, ValueError):
            previous = {}
        if isinstance(previous, dict) and previous.get('key') == signature:
            cover = previous.get('cover', {})
            try:
                raw = base64.b64decode(cover['data'], validate=True)
                image = fitz.Pixmap(raw)
                valid = (cover['pdfSha256'] == pdf_hash and cover['crop'] == 'zh'
                             and cover['mime'] == 'image/jpeg' and cover['page'] == 1
                             and (image.width, image.height) == (cover['width'], cover['height'])
                             and 0 < image.width <= 640 and 0 < image.height <= 1200
                             and 0 < len(raw) <= 300 * 1024)
                if valid:
                    return cover
            except (KeyError, ValueError, TypeError, RuntimeError):
                pass
    with fitz.open(pdf) as document:
        page = document[0]
        rect = page.rect
        clip = fitz.Rect(rect.x0 + rect.width / 2, rect.y0, rect.x1, rect.y1)
        scale = min(480 / clip.width, 1000 / clip.height)
        for _ in range(4):
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip,
                                  colorspace=fitz.csRGB, alpha=False)
            raw = pix.tobytes('jpeg', jpg_quality=82)
            if len(raw) <= 300 * 1024:
                break
            scale *= .75
        else:
            raise ValueError('首页封面超过 300 KB，请检查 PDF 首页。')
    cover = {'mime': 'image/jpeg', 'page': 1, 'crop': 'zh', 'pdfSha256': pdf_hash,
             'width': pix.width, 'height': pix.height,
             'data': base64.b64encode(raw).decode('ascii')}
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({'key': signature, 'cover': cover}), encoding='utf-8')
    return cover


def export_job(job, pdf, title='', author='', source_override=None, *,
               source_language='en', legacy_tracking=None, translations_path=None,
               glossary_path=None):
    job, pdf = Path(job), Path(pdf)
    if source_language not in ('en', 'zh'):
        raise ValueError('原文语言必须是 en 或 zh。')
    meta = read(job / 'manifest.json')
    if meta.get('pages'):
        raise ValueError('页码试样任务不能作为全文阅读包，请使用完整任务。')
    source = Path(source_override or meta['source'])
    if sha(source) != meta['source_sha256']:
        raise ValueError('原文哈希与任务不匹配。')
    pages = verify_pdf(pdf, source, source_language)
    translations = read(translations_path or job / 'translations.json')
    segments, seen = [], set()
    for item in source_items(job, legacy_tracking):
        if item['id'] in seen:
            continue
        seen.add(item['id'])
        entry = translations.get(item['id'])
        if entry is None:
            raise ValueError('翻译缺失：' + item['id'])
        page = item.get('page_in_job')
        if not isinstance(page, int) or not 1 <= page <= pages:
            raise ValueError('片段缺少有效页码：' + item['id'])
        keep = isinstance(entry, dict) and entry.get('keep') is True
        translated = entry if isinstance(entry, str) else (item['source'] if keep else entry.get('zh', ''))
        if not isinstance(translated, str) or not translated.strip():
            raise ValueError('译文为空：' + item['id'])
        formulas = item.get('formula_context', [])
        source_text = restore_formulas(item['source'], formulas)
        translated = restore_formulas(translated, formulas)
        en, zh = (translated, source_text) if source_language == 'zh' else (source_text, translated)
        segments.append({'id': item['id'], 'page': page, 'source': en, 'zh': zh,
                         'keep': keep or translated == source_text,
                         'reason': entry.get('reason', '') if isinstance(entry, dict) else '',
                         'hasFormula': bool(formulas)})
    if not segments:
        raise ValueError('没有可导出的段落。')
    if legacy_tracking and set(translations) - seen:
        raise ValueError('早期译文存在无法定位页码的片段。')
    gpath = Path(glossary_path) if glossary_path else job / 'glossary.json'
    glossary = normalize_glossary(read(gpath) if gpath.exists() else {}, source_language)
    verification = read(job / 'verification.json') if (job / 'verification.json').exists() else {}
    return {'cover': render_cover(pdf, job), 'format': 'yuejian-babeldoc-v1', 'pdfSha256': sha(pdf), 'sourceSha256': meta['source_sha256'],
            'title': title or source.stem, 'titleEn': next((s['source'] for s in segments if len(s['source']) > 25), source.stem),
            'author': author, 'engine': 'BabelDOC ' + meta.get('babeldoc', ''), 'pageCount': pages,
            'sourceLanguage': source_language, 'segments': segments, 'glossary': glossary,
            'bindingCheck': {'dpi': 72, 'sourceSide': 'right' if source_language == 'zh' else 'left', 'pages': pages},
            'review': verification.get('visual_review', 'pending'),
            'note': '段落来自翻译任务的去重片段与译文词典，不是完整 PDF 转写；图表、脚注、重复段落及后期排版修复请以最终 PDF 为准。公式原始字符仅作辅助核对。'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--source', help='原文移动后的实际路径；仍会校验原文哈希')
    parser.add_argument('--source-language', choices=['en', 'zh'], default='en')
    parser.add_argument('--legacy-tracking', help='早期 translate_tracking.json，提供片段页码')
    parser.add_argument('--translations', help='早期译文词典路径')
    parser.add_argument('--glossary', help='可选术语表路径')
    parser.add_argument('--title', default='')
    parser.add_argument('--author', default='')
    args = parser.parse_args()
    result = export_job(args.job, args.pdf, args.title, args.author, args.source,
                        source_language=args.source_language, legacy_tracking=args.legacy_tracking,
                        translations_path=args.translations, glossary_path=args.glossary)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Exported {len(result["segments"])} segments, {result["pageCount"]} pages to {output}')
