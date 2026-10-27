"""Synthetic covers only: no real papers or translation data."""
import base64
import hashlib
from pathlib import Path
import tempfile
import unittest
import pymupdf as fitz
from scripts.import_babeldoc import render_cover


class CoverExportTests(unittest.TestCase):
    def test_final_pdf_chinese_half_and_file_binding(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            pdf = root / 'dual.pdf'
            with fitz.open() as document:
                page = document.new_page(width=800, height=600)
                page.draw_rect(fitz.Rect(0, 0, 400, 600), color=(1, 0, 0), fill=(1, 0, 0))
                page.draw_rect(fitz.Rect(400, 0, 800, 600), color=(0, 0, 1), fill=(0, 0, 1))
                document.save(pdf)
            original = pdf.read_bytes()
            cover = render_cover(pdf, root)
            self.assertEqual(cover['pdfSha256'], hashlib.sha256(original).hexdigest())
            self.assertEqual((cover['mime'], cover['page'], cover['crop']), ('image/jpeg', 1, 'zh'))
            data = base64.b64decode(cover['data'], validate=True)
            self.assertLessEqual(len(data), 300 * 1024)
            pix = fitz.Pixmap(data)
            self.assertEqual((pix.width, pix.height), (cover['width'], cover['height']))
            red, green, blue = pix.pixel(pix.width // 2, pix.height // 2)
            self.assertGreater(blue, 240)
            self.assertLess(red, 10)
            self.assertLess(green, 10)
            self.assertEqual(render_cover(pdf, root), cover)
            self.assertEqual(pdf.read_bytes(), original)
            # A corrupted cache is repaired from the PDF, never exported as-is.
            (root / '.cache' / 'cover.json').write_text('{}')
            self.assertEqual(render_cover(pdf, root), cover)

    def test_tall_first_page_keeps_proportions_and_height_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            pdf = Path(folder) / 'tall.pdf'
            with fitz.open() as document:
                document.new_page(width=400, height=2000)
                document.save(pdf)
            cover = render_cover(pdf)
            self.assertLessEqual(cover['height'], 1000)
            self.assertLessEqual(cover['width'], 480)
            self.assertAlmostEqual(cover['height'] / cover['width'], 10, delta=.1)
