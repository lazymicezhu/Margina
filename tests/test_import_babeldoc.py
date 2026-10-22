"""Synthetic fixtures only; run with Python + PyMuPDF, no private PDFs."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import pymupdf as fitz
from scripts.import_babeldoc import export_job


class BundleExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.job = self.root / 'job'
        (self.job / 'batches').mkdir(parents=True)
        self.source = self.root / 'original.pdf'
        with fitz.open() as doc:
            p = doc.new_page(width=595.276, height=841.89)
            p.insert_text((40, 80), 'Original evidence 123')
            doc.save(self.source)
        self.write('manifest.json', {'source': str(self.source), 'source_sha256': hashlib.sha256(self.source.read_bytes()).hexdigest(), 'pages': None, 'babeldoc': '0.6.4'})
        self.write('batches/01.json', [{'id': 'stable-id', 'page_in_job': 1, 'source': 'English original', 'formula_context': []}])
        self.write('translations.json', {'stable-id': {'zh': '中文译文'}})
        self.write('glossary.json', {'evidence': '证据'})

    def write(self, name, obj):
        (self.job / name).write_text(json.dumps(obj, ensure_ascii=False))

    def dual(self, reverse=False, wrong=False):
        path = self.root / 'dual.pdf'
        with fitz.open(self.source) as original, fitz.open() as translated, fitz.open() as dual:
            rect = original[0].rect
            p = translated.new_page(width=rect.width, height=rect.height)
            p.insert_text((40, 80), 'Translated or unrelated text')
            p = dual.new_page(width=rect.width*2, height=rect.height)
            left, right = (translated, original) if reverse else (original, translated)
            if wrong: left = translated
            p.show_pdf_page(rect, left, 0)
            p.show_pdf_page(fitz.Rect(rect.width, 0, rect.width*2, rect.height), right, 0)
            dual.save(path)
        return path

    def test_batch_translation_files_are_not_source_segments(self):
        self.write('batches/01.zh.json', {'stable-id': '中文译文'})
        bundle = export_job(self.job, self.dual())
        self.assertEqual(len(bundle['segments']), 1)
        self.assertEqual(bundle['segments'][0]['zh'], '中文译文')

    def test_reverse_direction_and_nested_glossary(self):
        self.write('batches/01.json', [{'id': 'stable-id', 'page_in_job': 1, 'source': '中文原文'}])
        self.write('translations.json', {'stable-id': {'zh': 'English translation'}})
        self.write('glossary.json', {'direction': 'Chinese to English', 'terms': {'证据': 'evidence'}, 'evidence_policy': 'keep examples'})
        bundle = export_job(self.job, self.dual(reverse=True), source_language='zh')
        self.assertEqual(bundle['segments'][0]['source'], 'English translation')
        self.assertEqual(bundle['segments'][0]['zh'], '中文原文')
        self.assertEqual(bundle['glossary'], {'evidence': '证据'})
        self.assertEqual(bundle['bindingCheck']['sourceSide'], 'right')

    def test_unrelated_pdf_is_rejected_even_with_matching_dimensions(self):
        with self.assertRaisesRegex(ValueError, '不匹配'):
            export_job(self.job, self.dual(wrong=True))

    def test_partial_job_is_rejected(self):
        meta = json.loads((self.job / 'manifest.json').read_text())
        meta['pages'] = '1'
        self.write('manifest.json', meta)
        with self.assertRaisesRegex(ValueError, '试样'):
            export_job(self.job, self.dual())

    def test_legacy_tracking_recovers_page_and_does_not_guess_glyphs(self):
        text = 'Value {v1}'
        key = hashlib.sha256(text.encode()).hexdigest()[:16]
        self.write('tracking.json', {'page': [{'paragraph': [{'input': text, 'placeholders': [{'type': 'formula', 'placeholder': '{v1}', 'formula_chars': '(cid:1) 4'}]}]}]})
        self.write('translations.json', {key: '数值 {v1}'})
        bundle = export_job(self.job, self.dual(), legacy_tracking=self.job / 'tracking.json')
        self.assertEqual(bundle['segments'][0]['page'], 1)
        self.assertEqual(bundle['segments'][0]['zh'], '数值 ［公式请查看 PDF］')
        self.write('translations.json', {key: '数值 {v1}', 'unmapped': '缺页码'})
        with self.assertRaisesRegex(ValueError, '无法定位'):
            export_job(self.job, self.dual(), legacy_tracking=self.job / 'tracking.json')


if __name__ == '__main__':
    unittest.main()
