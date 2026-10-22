# Architecture / 架构

Margina is a static React + TypeScript application built with Vite. PDF.js renders PDFs in a Web Worker; IndexedDB stores local data. A Cloudflare Worker now provides a public catalog and authenticated upload / reading-record APIs, backed by D1 and private R2 bindings. The public Worker, D1 and private R2 storage are deployed; production Access protects only `/api/private/*` with email-code login and a 24-hour application session.

```text
PDF file → SHA-256 → PDF.js metadata / cover → IndexedDB Book
Translation job → Python adapter → JSON bundle → hash match → Book.bundle
Reader → page / bookmark / annotation updates → IndexedDB
Notes → Markdown download request
```

## Source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Public catalog, private shelves / notes, upload consent, local account controls |
| `src/AdminPanel.tsx`, `src/admin.css` | Administrator library controls and per-account notes, with mobile layout |
| `server/admin.mjs` | Server-side administrator checks, account directory, restore and resumable file deletion |
| `src/LocalLibrary.tsx` | Original local-only library and imports, preserving existing private data |
| `src/cloud-api.ts`, `src/cloud-types.ts` | API client, public PDF cache and cloud data shapes |
| `src/sync.ts`, `src/sync-merge.ts` | Persistent per-account outbox, incremental pull, compare-and-swap and three-way merge |
| `server/worker.mjs`, `server/auth.mjs`, `server/validation.mjs` | Public/private API routing, Access JWT verification, loopback test login and input validation |
| `server/schema.sql` | Catalog, account directory, versioned private snapshots and storage reservations |
| `src/Reader.tsx` | PDF rendering, paragraph view, selection, notes, glossary, page navigation |
| `src/interactions.tsx` | Shared spring feedback, short-message reveal, Grid disclosure and clipboard feedback |
| `src/catalog.ts`, `src/bundle.ts` | Versioned local catalog imports, bundle validation; metadata-only updates preserve reading records |
| `src/pdf.ts` | PDF.js worker setup, metadata, thumbnail and SHA-256 book identity |
| `src/storage.ts` | IndexedDB transactions and Markdown formatting / download |
| `src/types.ts` | Book, annotation, bundle and coordinate types |
| `src/style.css`, `src/design.css`, `src/text-layer.css` | Responsive UI and PDF selectable text layer |
| `scripts/prepare-assets.mjs` | Copy PDF.js fonts, CMaps and WASM from installed dependencies |
| `scripts/import_babeldoc.py` | Validate and export existing translation jobs |

## Compatibility and persistence

- Database: `yuejian-library`, version 1; object stores: `books` and `settings`.
- Bundle discriminator: `yuejian-babeldoc-v1`; conventional suffix: `.yuejian.json`.
- These names predate Margina and remain stable to preserve existing data.
- A book's ID is the SHA-256 of its PDF bytes. Different PDF revisions create distinct books; annotations are not automatically migrated between revisions.
- `Book` stores the PDF Blob, metadata, cover, progress, bookmarks, annotations and optional bundle. Annotation IDs use UUIDs.
- PDF highlight rectangles are normalized to the entire original page. The Chinese crop offset is applied at rendering and selection time. Paragraph notes use stable segment IDs and page numbers.
- Writes complete on IndexedDB transaction completion. New account state is stored under `settings[account-v1:<subject>]`; no schema upgrade or rewrite of legacy books is needed. Cross-tab account writes use atomic settings transactions and browser locks when available. BroadcastChannel refreshes account state. The legacy local-only editor retains its original concurrency limitations.
- Public file blobs can be cached once in `books`, but account notes are overlaid at read time and never written into guest records. Signing out hides the account view; it does not erase the browser’s stored account cache.
- Server reading snapshots use a unique `(user_id, book_id)` key and an autoincrement sequence. An atomic conditional `INSERT OR REPLACE` accepts only the expected version; conflicts return the current snapshot. Replacements allocate a new sequence for incremental pulls. Shelf removal sets `shelf=false`, retaining notes and preventing resurrection by unrelated offline edits.
- Clients merge remote snapshots with their last acknowledged base. Notes merge by ID; concurrent edits preserve a deterministic conflict copy, and a concurrent edit survives deletion. Bookmark membership merges independently. Progress follows the later reported open time and can move backwards; device clock skew remains a limitation. Pending mutations survive reload, and edits arriving during a request are preserved.
- D1 atomically reserves file bytes before upload; R2 verifies the supplied SHA-256 while streaming the PDF. Publication follows upload and signature checking. Failed/duplicate objects release their reservation only after deletion. The default 8 GB budget includes withdrawn files and in-flight reservations. Interrupted uploads can leave conservative reservations/orphans for later maintenance; D1 and R2 do not share a transaction.

## Bilingual layout

The supported workflow produces a double-width page: English on the left and Chinese on the right (either language may be the original). Cropping is visual only; the original Blob is unchanged. The canvas and selectable text layer must use the same crop position. A stable scrollbar gutter prevents page-width changes from triggering repeated PDF rendering near overflow thresholds. Bitmap density follows devicePixelRatio × visualViewport.scale, with a 180 ms debounce after viewport changes. Density-only redraws replace the bitmap when ready without rebuilding the selectable text layer or changing highlight coordinates. `pdf-resolution.ts` bounds each bitmap to 12 million pixels and an 8192-pixel side; these are application memory budgets, not browser capability claims. Superseded bitmaps are released.

Paragraph mode is an alternate view of translation-job segments, not a PDF extraction or reflow engine. Desktop comparison uses two columns; narrow screens stack the two languages. Figures and precise formulas remain in the PDF.

## Network and deployment boundary

The reader, thumbnail loader and text layer use the same PDF.js legacy build and matching versioned worker asset for Safari compatibility. Public cached blobs are checked against their SHA-256 IDs before use; failed reads or mismatches fetch a fresh PDF with the HTTP cache bypassed. Only file fields are patched, preserving guest annotations, bookmarks and progress. A single-record IndexedDB lookup reads and hashes the cached PDF once. The verified ArrayBuffer is passed separately from Book through a transient PdfSource to Reader, then transferred to PDF.js and released from the source; it is never persisted or copied for a normal cached open. Metadata writes are skipped when unchanged. A metadata/progress write cannot invalidate the already-read bytes. Cache repairs verify the download hash and size and reuse the existing cover instead of parsing the PDF twice. First imports still parse once for a cover before opening. Reader reload replaces the blob and byte source without changing account records. The database schema and stored Book format remain unchanged. Console errors distinguish cache reads, reader reads, and parser failures; real iPhone standalone-mode validation remains pending.

Runtime PDF resources are served locally from `/pdf-assets/`; no CDN or translation endpoint is used. Optional samples are fetched from `/samples/catalog.json`. Missing samples (including a static host's HTML fallback) result in an empty library.

Local Wi-Fi previews can bind Vite preview to `0.0.0.0`. `src/browser-compat.ts` preserves SHA-256 book identities and UUID annotation IDs when HTTP LAN origins lack SubtleCrypto / randomUUID; hashing and data storage remain browser-side. Clipboard copying falls back to the browser copy command.

Asset URLs currently assume hosting at the origin root. GitHub Pages subpath hosting is not configured. Cloudflare Workers/D1/R2 implementation and local simulation are present; production resources and path-scoped Access are configured. This repository’s CI only checks and builds code. `/api/catalog` and `/api/papers/*` are public; `/api/private/*` requires a verified Access JWT in production. Local identity requires both explicit local environment flags and a loopback hostname. See [Cloudflare setup](CLOUDFLARE.md).

## Interface behavior

`design.css` defines neutral theme surfaces and a 40-point dark-mode weight compensation. PDF canvases and their selectable text-layer geometry remain independent of theme typography. Disclosure uses Grid rows (0fr → 1fr), without measuring content height. Unit-mass spring samples use stiffness/damping 1200/80 for file-drag feedback and 380/18 for affirmative icons. Short interface messages reveal characters over 90 ms, staggered by 30 ms; paper content renders immediately. Copy feedback holds for 2500 ms and fades for 180 ms before resetting. Motion honors the system reduced-motion preference.

Catalog revision is stored in `settings.localCatalogRevision`; legacy `initialized` remains compatible. Catalog updates patch existing books by PDF hash and never replace annotations, bookmarks or reading progress.

## Public build boundary

`npm run build:cloud` disables Vite’s automatic public-directory copy and explicitly includes only PDF.js assets under `pdf-assets/`. `dist-cloud/` therefore excludes `public/samples/`. The ordinary `npm run build` still preserves the legacy local sample workflow in `dist/`; it is not the deployment artifact. Neither command deploys.

## Administrator controls

`/admin` is the frontend entry, while `/api/private/admin/*` requires a verified identity and administrator email on every request. Accounts are indexed in `users` on authenticated requests, with last-seen writes throttled to hourly. Notes are read from versioned D1 snapshots, never from another account’s browser storage. Catalog deletion transitions `removed` from 0/1 to 3 before touching R2; state 3 blocks restore and bundle publication, retains object keys for retry, and becomes 2 only after file deletion and reservation release. Metadata and personal reading snapshots remain. State 1 is reversible withdrawal. Applying the schema again excludes states 2/3 from legacy PDF allocation backfill.

Production deployment uses ignored `wrangler.production.jsonc`, `npm run db:cloud` and `npm run deploy:cloud`; the latter builds only the public asset allowlist. `ADMIN_EMAILS` is a Worker Secret. Hostname-based Access covers `/api/private/*`, leaving catalog and files public. Worker-wide Access must not be enabled for a publicly readable library.
