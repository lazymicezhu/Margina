# BabelDOC adapter / 双语阅读包

The adapter reuses `academic-pdf-bilingual` jobs produced with BabelDOC 0.6.4. It does not translate, call an API, modify originals, or replace the workflow's translation review.

## Requirements

Use the translation workspace's existing Python environment with PyMuPDF. The adapter was validated with PyMuPDF 1.28.2. Python is optional for the web reader; it is only needed to export bundles. See PyMuPDF's license note in [THIRD_PARTY.md](../THIRD_PARTY.md).

Expected job files:

```text
job/
  manifest.json          # source path, SHA-256, engine version, page selection
  batches/*.json         # segments, page_in_job and formula_context
  translations.json     # translated strings, or zh / keep / reason entries
  glossary.json         # optional term → translation dictionary
  verification.json     # optional previous review metadata
```

## Export

```sh
/path/to/translation-workspace/.venv-babeldoc/bin/python scripts/import_babeldoc.py \
  --job /path/to/job \
  --pdf /path/to/final-bilingual.pdf \
  --source /path/to/original-english.pdf \
  --title 'Paper title' \
  --author 'Author · Year' \
  --out /path/to/paper.yuejian.json
```

`--source` is optional if the manifest's original path is still valid. Always pass the final, repaired bilingual PDF, not an intermediate Chinese draft. The exporter checks:

1. Original source SHA-256 against the job manifest.
2. Full-job status (page-selection samples are rejected).
3. Page count and double-width geometry.
4. Each English half against the original rendered at 36 DPI.
5. Presence of translations for all exported segments.

This verifies binding and structure, not semantic correctness. The `review` field is copied from an existing job record; it is not a new visual or translation review.

## Import and compatibility

Select the PDF and JSON together in the library, or import the PDF first and the JSON afterward. The browser validates the bundle format, page ranges, PDF hash and page count before attaching it. A PDF edited after export needs a newly exported bundle.

Required fields follow `Bundle` in [`src/types.ts`](../src/types.ts): format, PDF / source hashes, titles, author, engine, page count, segments, glossary, review and explanatory note. The format remains `yuejian-babeldoc-v1` for existing preview data. Paths and API configuration are not included.

## Fidelity limits / 内容边界

Batches may deduplicate repeated passages, contain cross-column fragments, or predate later PDF repairs. Formula placeholders are replaced only with supplied `formula_chars`; unresolved formulas are marked `［公式请查看 PDF］`. Complex notation, figures, captions, footnotes and revised text must be checked in the final PDF. Paragraph mode should never be labeled a complete, verified transcription.
