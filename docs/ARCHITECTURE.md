# Architecture / 架构

Margina is a static React + TypeScript application built with Vite. PDF.js renders PDFs in a Web Worker; IndexedDB stores local data. A Cloudflare Worker now provides a public catalog and authenticated upload / reading-record APIs, backed by D1 and private R2 bindings. The public Worker, D1 and private R2 storage are deployed; production Access protects `/api/private/*` for email verification. Password-authenticated clients use `/api/account/*`, with the same Worker authorization and account isolation.

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
| `src/LocalLibrary.tsx` | Legacy local-only library (no current app entry); shared Logo export |
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
- A local/public book ID is the SHA-256 of the original PDF/TXT bytes. Private cloud IDs are SHA-256 of `private:<owner>:<content hash>`, with the original hash separately stored as `content_hash` / `Book.contentHash`; identical files across owners do not share private metadata or reading records. Different PDF revisions create distinct books; annotations are not automatically migrated between revisions.
- `Book` stores the original file Blob, optional `format` (missing means PDF), optional `contentHash` / `privateOwner`, metadata, cover, progress, bookmarks, annotations and optional bundle. Annotation IDs use UUIDs.
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

Asset URLs currently assume hosting at the origin root. GitHub Pages subpath hosting is not configured. Cloudflare Workers/D1/R2 implementation and local simulation are present; production resources and path-scoped Access are configured. GitHub Actions only checks and builds code; Cloudflare Workers Builds can independently deploy `main` using the tracked production config. `/api/catalog` and `/api/papers/*` return only public documents; private metadata/files/bundles use `/api/private/files/:id` with owner/admin checks, and private cache fallbacks check the current account; With `PASSWORD_AUTH=true`, both private and account routes require a valid Margina session; Access JWTs are used specifically for email verification. Before that flag is enabled, legacy Access authentication remains available. Local identity requires both explicit local environment flags and a loopback hostname. See [Cloudflare setup](CLOUDFLARE.md).

## Interface behavior

`design.css` defines neutral theme surfaces and a 40-point dark-mode weight compensation. PDF canvases and their selectable text-layer geometry remain independent of theme typography. Disclosure uses Grid rows (0fr → 1fr), without measuring content height. Unit-mass spring samples use stiffness/damping 1200/80 for file-drag feedback and 380/18 for affirmative icons. Short interface messages reveal characters over 90 ms, staggered by 30 ms; paper content renders immediately. Copy feedback holds for 2500 ms and fades for 180 ms before resetting. Motion honors the system reduced-motion preference.

Catalog revision is stored in `settings.localCatalogRevision`; legacy `initialized` remains compatible. Catalog updates patch existing books by PDF hash and never replace annotations, bookmarks or reading progress.

## Public build boundary

`npm run build:cloud` disables Vite’s automatic public-directory copy and explicitly includes only PDF.js assets under `pdf-assets/`. `dist-cloud/` therefore excludes `public/samples/`. The ordinary `npm run build` still preserves the legacy local sample workflow in `dist/`; it is not the deployment artifact. Neither command deploys.

## Administrator controls

`/admin` is the frontend entry, while `/api/private/admin/*` requires a verified identity and administrator email on every request. Accounts are indexed in `users` on authenticated requests, with last-seen writes throttled to hourly. Notes are read from versioned D1 snapshots, never from another account’s browser storage. Catalog deletion transitions `removed` from 0/1 to 3 before touching R2; state 3 blocks restore and bundle publication, retains object keys for retry, and becomes 2 only after file deletion and reservation release. Metadata and personal reading snapshots remain. State 1 is reversible withdrawal. Applying the schema again excludes states 2/3 from legacy PDF allocation backfill.

Production deployment uses tracked `wrangler.jsonc`, `npm run db:cloud` and `npm run deploy:cloud`; the latter builds only the public asset allowlist. The config contains public resource identifiers and non-secret runtime variables only. Workers Builds connects the existing Worker to GitHub `main`, runs `npm test && npm run build:cloud`, then `npx wrangler deploy --config wrangler.jsonc`. Runtime secrets remain in Cloudflare and database migrations are an explicit release operation, not an automatic build step. `ADMIN_EMAILS` is a Worker Secret. Hostname-based Access covers `/api/private/*`, leaving catalog and files public. Worker-wide Access must not be enabled for a publicly readable library.

## TXT and upload visibility

`src/txt.ts` is shared by the browser and Worker. It decodes UTF-8, BOM-marked UTF-16 or GB18030, normalizes CRLF/CR and partitions text into at most 1200 UTF-16 code units per page, preferring a line break after 600 and avoiding split surrogate pairs. This pagination is independent of font size and viewport; changing it requires progress/note migration. The original bytes determine content identity and remain downloadable. TXT uses the existing flow reader and segment-based excerpts, never PDF.js or HTML injection. The Worker independently validates TXT and derives its page count; maximum size is 10 MiB.

D1 adds `papers.visibility` (default `public` for existing rows) and `content_hash`; `pdf_key` is retained as the primary file key for compatibility, with format derived from its server-generated `.pdf`/`.txt` suffix. Apply `server/migrations/0001-private-text.sql` once before deploying to an old database. Fresh databases use schema.sql directly. Do not roll back to a Worker that does not filter visibility after private data exists. IndexedDB remains version 1; fields are additive. Legacy local-only lists exclude private cloud caches, account switches clear private metadata, and private cached reads require the owner/admin session in the app. Browser site storage remains device-local, not encrypted per-account storage.

Uploads send `X-Paper-Visibility`; older clients without it retain explicit-consent public behavior. Private uploads do not change an existing public file; public uploads do not publish a private record. Bundle attachment follows the same visibility and matches the original content hash. Owner uploads and admin listings include private records; public catalogs, metadata and file endpoints exclude them, including HEAD requests. Reading-record writes enforce file visibility. Removing/restoring a document never changes visibility. File downloads are no-store at the HTTP layer and use IndexedDB as the explicit cache.

## Reading navigation

`ContinuousPages.tsx` keeps stable numbered page slots, mounts nearby content via one IntersectionObserver and retains measured slot heights when distant text/PDF canvases unmount. The reading scroller tracks the visible page for progress without invoking explicit page jumps. Explicit next/previous/page-number requests scroll after DOM commit with instant behavior; paged mode disables scroll anchoring to avoid restoring the previous page’s offset. TXT and paragraph selections use their containing page number; PDF selections retain each page’s normalized rectangles. Browser preference `margina-reading-layout` selects continuous or paged navigation without changing persisted page or note identities.

Selection toolbar coordinates are transient viewport positions derived from the live browser selection, separate from persisted PDF highlight rectangles. Selection changes, scrolling, resizing and visual viewport changes reposition the toolbar within the visible reading area; a color click saves immediately. In paged mode, mouse clicks in the reading area’s blank gutters outside the rendered paper’s left/right edges turn pages after a short double-click grace period; selection, dragging, controls, scrolling and zoomed PDF panning suppress click navigation.

## Shelf folders and title remarks

`server/shelf.mjs` and `src/useShelf.ts` keep folder membership and personal title remarks separate from versioned reading snapshots. D1 tables `shelf_folders`, `shelf_items`, and `shelf_unlocks` are introduced by `0002-shelf-folders.sql`. Every route uses the authenticated account owner. A remark overrides the title only in account display; it never enters shared file metadata or changes the public title. Folder edits are online operations with last-write-wins behavior.

Optional passwords use random salts and PBKDF2-SHA256 (100,000 iterations); plaintext passwords are not stored. Unlock tokens have 256 bits of randomness, are stored hashed server-side, and expire after eight hours. The client keeps one token in memory, so reloading or switching accounts locks folders again; unlocking another protected folder relocks the previous one. Five wrong passwords impose a one-minute cooldown. Password changes revoke existing sessions. Removing a folder requires unlock and returns its books to the shelf root without losing remarks or reading records.

Locked books are withheld from personal record pulls and uploads lists; private file/bundle reads, record writes, reuploads and shelf edits enforce the same check. Incremental cursors advance over withheld records, and the client restarts a pull after access is restored. Cached book opening and personal note/export views also check access. Initial account loading and failed access refreshes fail closed. Public copies remain public, and the administrator’s previously authorized access to account notes is unchanged. This is application access control, not encryption at rest: existing browser caches and D1/R2 files are not encrypted with the folder password. Account shelf access now needs a successful online access refresh; the legacy local library no longer has an app entry. Settings no longer offers guest-record merging or a My uploads shortcut; My uploads remains directly accessible in desktop and mobile navigation. Existing browser data is retained.

## Public library folders

`server/catalog-folders.mjs` manages public classification separately from personal shelf folders. Additive migration `0004-catalog-folders.sql` (also included in the idempotent `schema.sql`) creates `catalog_folders` and `catalog_items`; papers and reading records are not rewritten. Each document belongs to at most one public folder. Foreign-key deletion cascades only membership rows, returning documents to the root while preserving files and personal records. Apply the schema before deploying the updated Worker.

Guests can list folders and documents. Authenticated users can create up to 100 folders each; only the creator or an administrator can rename/delete a folder. Only a document's uploader or an administrator can move it. Catalog and upload listings return a session-specific `canOrganize` boolean without revealing uploader identity; the administrator listing additionally joins the current folder ID/name. Library cards and administrator rows open the same placement dialog, and each view refreshes after a successful move. Administrators can also classify withdrawn public documents; deleted/incomplete-deletion and private documents cannot enter public folders. These controls do not grant access to another account’s personal shelf. Public responses expose folder names, counts and a per-session management boolean, never creator identities. Counts and queries include only available public documents. `/api/catalog?folder=` lists root documents, `folder=<id>` scopes search and pagination, and omitting `folder` preserves the existing all-library API. The frontend uses all-library search from the root and scoped search inside a folder.

Public file uploads send `X-Catalog-Folder`; metadata and membership are published in one D1 batch after R2 validation. An invalid/deleted destination cannot leave partially published metadata. Duplicate uploads keep the winning document's location; reading bundles follow their PDF. Private uploads cannot target public folders. The upload dialog offers personal shelf destinations instead, completing files and bundles, syncing reading records, and then applying the existing shelf membership API. This order allows uploads into locked personal folders without blocking bundle attachment or initial sync; classification failures are reported separately from successful file uploads and can be retried. IndexedDB and bundle discriminators are unchanged.

## Password accounts

`server/password-auth.mjs` adds verified-email enrollment/recovery, password login, and revocable opaque sessions. `0003-password-accounts.sql` adds four additive tables; existing user and document IDs stay unchanged. Cloudflare Access is configured with Allow → Include → Login Methods → One-time PIN, permitting any verified email; it still covers `/api/private/*`. `/api/auth/start` creates browser-bound random state and redirects to the Access-protected `/api/private/auth/verify`. The callback verifies the signed Access JWT and consumes that state before issuing a 15-minute, single-use HttpOnly setup grant. Existing active Access sessions may satisfy email verification without a new code. The proof's verified email and server-selected account ID are authoritative; form email/role fields cannot set ownership or administrator privileges.

New accounts set passwords of 10–128 characters. Passwords use random salts, HMAC-SHA256 with a separate `AUTH_PEPPER` Worker secret, then Workers-supported PBKDF2-SHA256 with 100,000 iterations. D1 stores only the derived hash. The pepper must be backed up and not casually rotated: losing or rotating it requires email-based password recovery. Login tokens have 256 random bits and are stored only as SHA-256 hashes in D1; browser cookies are `__Host-` scoped, Secure, HttpOnly, SameSite=Lax, with a fixed 30-day lifetime. Logout revokes the current session; password reset revokes all account sessions and outstanding setup grants. Login and recovery endpoints are rate limited per IP, with an additional login limit per normalized email. Unknown accounts get the same login error and password derivation work. Writes retain same-origin checks.

`/api/account/*` is rewritten internally to the existing private handlers, including all owner/admin/folder checks; it does not bypass Worker authentication. The browser uses these endpoints for password sessions while the original Access paths remain available for verification and legacy clients. When the password feature is enabled, an Access cookie alone does not authenticate application requests. An `X-Margina-User` mismatch remains an error. New signup is an ordinary account; only emails in `ADMIN_EMAILS` can access administrator APIs.

This flow uses Access solely as its email identity provider, avoiding a new outbound-mail subscription. Registration/recovery still counts toward the existing Zero Trust free-plan user capacity. Full public registration beyond that capacity requires replacing the verification provider or upgrading the relevant service. Browser-managed cookies can still be removed by the user or OS before their maximum lifetime. No plaintext passwords or session values are logged or sent to analytics.

## Shelf ratings and automatic covers

Reading snapshots accept optional integer `rating` (0–5); missing values mean unrated. Ratings merge independently from progress, bookmarks and notes through the existing account queue. Conflicting rating changes follow the existing remote-wins scalar rule. Shelf folders sort by rating descending, then last opened descending, then ID. No database migration is needed; existing `starred` values retain their original meaning.

`paper_covers` (additive migration `0005-paper-covers.sql`) maps a document and crop (`full`/`zh`) to a versioned JPEG object in private R2. Uploaded PDFs save their generated thumbnail; optional bundle `cover` fields are validated and stored separately. Binding checks require the final PDF hash, page 1, actual JPEG frame dimensions and at most 300 KiB. New bilingual exports embed the Chinese/right first-page image, preserving `yuejian-babeldoc-v1` compatibility. Cover storage participates in storage reservations; replacement cleans old objects, and deletion cleans all cover variants. A new crop uses a separate mapping, avoiding a full-spread cover after a bilingual bundle is attached.

`PaperCover.tsx` loads visible stored images with two concurrent lanes. Versioned display caches live in `settings[cloud-cover-v1:<owner/public>:<id>:<crop>:<version>]`. Private image requests use the same authenticated file route and folder-unlock header as the document; access is checked before ETag handling and private HTTP responses are no-store. Public images revalidate through the Worker, so withdrawal still blocks new requests. The component hides images on account/folder changes.

Missing legacy covers are generated once by an uploader/admin viewing that card, then persisted; guests and non-owners do not parse PDFs merely for thumbnails. A compatible local book cover can avoid regeneration. Backfill has a 60-second bound and retains the title cover on failure; ordinary image loads have a 15-second bound. This is lazy backfill, not a completed migration of every existing paper. It does not alter notes or reading progress. PDF range support remains available for the one-time generation; opening a document still verifies the full PDF hash.

## Shelf metadata loading

`/api/account/metadata?ids=...` resolves up to 40 IDs in one D1 metadata query, after account identity and shelf access checks. Public and owner/admin private metadata share this authenticated path, avoiding the previous public-404/private fallback per book. Locked IDs return no metadata; unavailable IDs do not disclose whether the file is absent, withdrawn or belongs to another account. The endpoint never reads R2 or file bytes.

`usePaperMetadata.ts` batches at most two requests concurrently, cancels superseded requests, and keys work by account, accessible document IDs and explicit retry revision rather than changing reading snapshots. Completed batches stay visible while others load. A 15-second request timeout remains retryable. Display-only metadata uses `settings[paper-metadata-v1:<account>]`; it is only presented after shelf access is known, does not grant file access, and does not change the IndexedDB schema. Pending/error states are separate from confirmed unavailability. Cached titles survive transient errors; account changes hide prior private metadata, and confirmed unavailable entries are removed from this metadata cache.

## Reader browser history

`reader-navigation.ts` adds one history entry when a document is opened, including while the file is loading. History state contains only an opaque session/ticket marker; origin list snapshots and document metadata stay in memory. Back restores the source view, folders, search, loaded catalog pages and window scroll; the reader button consumes the same entry. Forward restores the origin and uses the normal authenticated file-opening path without pushing another entry. Navigation tickets invalidate late asynchronous completions. Account changes discard all remembered entries, and reloading starts on the library; history is not a deep-link or authorization mechanism. This is scoped to opening/closing the reader, not general tab, dialog or folder routing.

## Notes grouped by document

`BookNotes.tsx` groups the current account's accessible annotations by book ID (not title). The parent retains the expanded book across reader navigation; no new notes storage or server aggregate is introduced. Group order follows most recent note edit; notes within a book follow page then creation order. Jumping to a note clamps its page to the current document. All-book and per-book Markdown exports use the same existing formatter. Cover counts derive from the same per-account annotations, render only when nonzero and remain hidden while folder access is unavailable or locked.
