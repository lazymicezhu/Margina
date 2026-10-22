# Architecture / 架构

Margina is a static React + TypeScript application built with Vite. PDF.js renders PDFs in a Web Worker; IndexedDB stores local data. There is no server API, account, or synchronization service.

```text
PDF file → SHA-256 → PDF.js metadata / cover → IndexedDB Book
Translation job → Python adapter → JSON bundle → hash match → Book.bundle
Reader → page / bookmark / annotation updates → IndexedDB
Notes → Markdown download request
```

## Source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Library, PDF / bundle imports, optional local samples, application state |
| `src/Reader.tsx` | PDF rendering, paragraph view, selection, notes, glossary, page navigation |
| `src/pdf.ts` | PDF.js worker setup, metadata, thumbnail and SHA-256 book identity |
| `src/storage.ts` | IndexedDB transactions and Markdown formatting / download |
| `src/types.ts` | Book, annotation, bundle and coordinate types |
| `src/style.css`, `src/text-layer.css` | Responsive UI and PDF selectable text layer |
| `scripts/prepare-assets.mjs` | Copy PDF.js fonts, CMaps and WASM from installed dependencies |
| `scripts/import_babeldoc.py` | Validate and export existing translation jobs |

## Compatibility and persistence

- Database: `yuejian-library`, version 1; object stores: `books` and `settings`.
- Bundle discriminator: `yuejian-babeldoc-v1`; conventional suffix: `.yuejian.json`.
- These names predate Margina and remain stable to preserve existing data.
- A book's ID is the SHA-256 of its PDF bytes. Different PDF revisions create distinct books; annotations are not automatically migrated between revisions.
- `Book` stores the PDF Blob, metadata, cover, progress, bookmarks, annotations and optional bundle. Annotation IDs use UUIDs.
- PDF highlight rectangles are normalized to the entire original page. The Chinese crop offset is applied at rendering and selection time. Paragraph notes use stable segment IDs and page numbers.
- Writes complete on IndexedDB transaction completion. No cross-tab conflict resolution or cross-device synchronization is implemented.

## Bilingual layout

The supported workflow produces a double-width page: original English on the left, final Chinese on the right. Cropping is visual only; the original Blob is unchanged. The canvas and selectable text layer must use the same crop position. A stable scrollbar gutter prevents page-width changes from triggering repeated PDF rendering near overflow thresholds.

Paragraph mode is an alternate view of translation-job segments, not a PDF extraction or reflow engine. Desktop comparison uses two columns; narrow screens stack the two languages. Figures and precise formulas remain in the PDF.

## Network and deployment boundary

Runtime PDF resources are served locally from `/pdf-assets/`; no CDN or translation endpoint is used. Optional samples are fetched from `/samples/catalog.json`. Missing samples (including a static host's HTML fallback) result in an empty library.

Asset URLs currently assume hosting at the origin root. GitHub Pages subpath hosting is not configured. Cloudflare hosting, authentication, database / object storage and sync are future work; this repository's CI only checks and builds code.
