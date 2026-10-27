# Margina

**Read. Reflect. Connect.**

English | [简体中文](README.zh-CN.md)

A mobile-first web reader for bilingual academic papers, with highlights, notes, and reading progress stored in your browser. Margina reuses final PDFs, translation segments, and glossaries from the `academic-pdf-bilingual` workflow powered by BabelDOC. It does not translate papers or require an AI API key.

> **v0.1.0.** Public library, account sync and an administrator console are implemented for Cloudflare Workers / D1 / R2. Follow the [deployment guide](docs/CLOUDFLARE.md) to publish directly; no local preview or Git push is required. The public site is deployed at https://margina.lazymicezhu.com with D1 and private R2 storage; email-verified registration, password login and the administrator console are implemented.

## Features

- My notes groups annotations by book, collapsed by default and ordered by latest edit. Expand a book to browse notes in page order, open the cited page, copy notes or export that book. Library/shelf/upload covers show a red ribbon with the personal note count along the right edge of the cover, only when nonzero; locked books and other accounts’ notes stay hidden.

- Opening a document creates a browser history entry. Browser Back and the reader’s Back button restore the previous list, folder, search and scroll position; Forward reopens the document with current account/folder access checks. A reload returns to the library rather than reopening an in-memory reader entry.

- Shelf metadata loads in batches of up to 40 books, with at most two batches in flight. Previously loaded titles are cached per account and shown again after folder access is checked. Pending requests display a loading state; connection failures offer a retry and do not mark books as withdrawn. Only a confirmed inaccessible document shows an unavailable state.

- Register by verifying an email once, then set a password and sign in with it. Sessions last 30 days; email verification also supports password recovery. Existing verified emails retain their account IDs, shelves and notes. Cloudflare Access still supplies registration/recovery verification, so its free-plan user limit still applies.

- Open on the personal shelf by default. Create account-synced folders, optionally password-protected, and organize books through each shelf card’s edit button. A personal title remark replaces the displayed title on your shelf and in the reader; clearing it restores the original. Original filenames and public catalog titles stay unchanged.
- Protected folders require their password after a page refresh. Folder locks guard personal notes, private file access and shelf edits; public library copies remain public. Deleting an unlocked folder moves its books to the shelf root.

- Browse and read the public library without signing in. Signed-in users can upload PDF / TXT files and matching PDF reading bundles, choosing private (default) or public visibility. Uploaded documents join the personal shelf.
- Browse shared library folders, create them after signing in, and select or create a destination during upload. Public uploads use library folders; private uploads use personal shelf folders. Folder creators and administrators can rename/delete shared folders; deleting one returns its documents to the library root. A visible “归类” action on the library and My uploads cards lets uploaders move their public documents. The administrator library shows each document’s folder and offers the same picker for all public documents, including withdrawn ones. Both entry points can create a destination or move a document back to the library root. Private documents remain in their owner’s personal shelf folders. Root search includes all folders; search within a folder stays scoped. Duplicate public uploads and reading bundles retain the PDF's existing location. Folder changes require a connection; private upload classification follows a successful reading-record sync.
- Shelf cards offer five-star personal ratings synced with the account. Higher ratings appear first within each shelf folder, then recently read books; a single star button on the right expands into five stars in place and collapses after selection; clicking the current rating again clears it. Edit and icon-only removal actions sit beside it. PDF uploads save a separate JPEG cover; reading bundles can embed the final PDF’s Chinese first-page thumbnail. Visible cards load that small image without parsing the PDF. Uploaders/admins fill missing legacy covers once when viewed; ordinary readers never download PDFs just for a cover. Private covers retain account/folder permissions, and TXT/offline failures keep a title cover. Redundant PDF labels and filename subtitles are hidden. Completed administrator deletions disappear from library management and upload lists; interrupted deletions remain available to retry.
- Separate each account’s notes, highlights, bookmarks and progress; synchronize changes with version checks, conflict copies, deletion tracking and a persistent local queue. Removing a shelf item preserves notes and the public file.
- Settings omits local-library import, guest-record merging and the upload-management shortcut. My uploads remains in desktop and mobile navigation; existing browser data is preserved.

- Read TXT (up to 10 MB, UTF-8 / BOM-marked UTF-16 / GB18030) with adjustable font size, fixed pagination, swipe navigation, excerpts, notes and synced progress. Text is rendered as plain text, never HTML. TXT prose uses justified lines and 16 px side padding on phones; paragraph endings and explicit line breaks remain natural.
- Import PDFs, deduplicate by SHA-256, search the library, and star papers.
- Use the PDF.js compatibility build for Safari. Public PDF caches are checked before reading and replaced if unreadable or mismatched, preserving notes and progress; verified bytes go directly to the reader without a second cache read. Unchanged public metadata does not rewrite the PDF cache. Failed reads offer a reload action.
- Read the Chinese half, English half, or full spread of a bilingual PDF. PDF rendering follows screen pixel density and redraws after pinch zoom, within a bounded bitmap memory budget; low-resolution scans retain their source detail.
- Open in the original PDF by default, with the Chinese half selected for bilingual papers, even when a reading bundle is present. Manually switch to mobile-friendly paragraphs using a matching translation bundle; compare languages and consult the original glossary.
- Choose continuous vertical scrolling or left/right page turns for TXT, PDF and paragraph views; the browser remembers the choice. Continuous reading mounts nearby pages only and follows the visible page for progress. Page buttons and page-number jumps land at the page top. Text selection and pinch zoom remain available; enlarged PDFs keep horizontal panning.
- In paged mode, desktop mouse clicks on the left/right halves of the reading area go to the previous/next page. Text selection, double-click selection, controls and zoomed PDF panning keep their normal behavior.
- Select text to show a toolbar beside the selection; it follows selection changes and scrolling, stays inside the visible reading area, and hides when the selection is offscreen. Click a color to save the highlight immediately, or choose notes; TXT and paragraph reading have no per-paragraph note buttons. Existing notes, bookmarks and progress are preserved.
- Use a quiet, borderless interface with automatic light/dark appearance, collapsible explanations, and copyable notes. Copy confirmation fades after 2.5 seconds; reduced-motion preferences are respected. PDF artwork keeps its original colors.
- Request Markdown exports of notes. End-to-end browser download validation remains pending.

Paragraph mode uses intermediate translation segments. It can omit repeated content or later layout repairs; the final PDF remains authoritative for figures, formulas, footnotes, and revisions. Scanned PDFs can be rendered but do not gain selectable text or OCR.

## Cloudflare deployment

Follow the [step-by-step guide](docs/CLOUDFLARE.md) to create D1/R2, configure email login and set `ADMIN_EMAILS`. The `/admin` console provides account notes and library upload, withdrawal, restore and deletion. The tracked `wrangler.jsonc` contains the existing Margina production bindings and non-secret settings. Runtime secrets remain in Cloudflare. The existing Worker is connected to this repository with Workers Builds (2026-10-27): pushes to `main` trigger deployment; the build command is `npm test && npm run build:cloud` and deploy command `npx wrangler deploy --config wrangler.jsonc`. GitHub Actions independently checks builds. `npm run deploy:cloud` remains available for an explicitly requested manual release.

Before deploying stored covers, apply `server/migrations/0005-paper-covers.sql` (or the current idempotent `server/schema.sql`) to the existing D1 database. No paper or reading-record migration is required.

Before deploying the library-folder feature to an existing database, apply `server/migrations/0004-catalog-folders.sql` or rerun the current `server/schema.sql`. Both add tables without rewriting papers or reading records; changing source files alone does not update the live site.

## Local development

Use **Node.js 22.13+** and npm. The `.nvmrc` selects Node 22; install the current patch version of that line.

```sh
git clone https://github.com/lazymicezhu/Margina.git
cd Margina
npm ci
npm run build:cloud
npm run dev:cloud
```

Local folder names containing a colon (such as some iCloud paths on macOS) are supported through a temporary development-server path alias; project files remain in their original folder.

Open [the local library preview](http://127.0.0.1:8787/). Use Login → test account A or B to try uploads and private shelves. All service data stays under the ignored `.wrangler/` directory; test identities are loopback-only and are not real cloud accounts. Rebuild with `npm run build:cloud` after frontend changes. See [Cloudflare implementation and setup](docs/CLOUDFLARE.md).

`npm run dev` still starts the frontend-only Vite server. Without the local Worker, the public library reports an unavailable service. For a frontend-only production build preview:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Open [the local preview](http://127.0.0.1:4173/). Both servers listen on loopback by default; this address is not reachable from a separate phone. Responsive layout has been checked at mobile browser dimensions, but real iOS/Android interactions still need testing.

A fresh clone starts with an empty public library. Log into a local test account and use Upload to publish a shareable PDF to the local service. For private files, choose private visibility in Upload. No research papers or translation jobs are included in the repository. Optional legacy samples are not exposed by the current app.


### Preview over Wi-Fi

After building, run `npm run preview -- --host 0.0.0.0 --port 4180 --strictPort`. Connect your phone to the same Wi-Fi and open `http://<computer-LAN-IP>:4180`. Keep the computer awake and the preview process running. Use a trusted local network: files bundled from `public/`, including local samples, are available to devices that can reach this port. This is a local preview, not a public deployment.

HTTP LAN access supports PDF hashing and annotation IDs through browser-side fallbacks; copying notes uses the browser's legacy copy action when the Clipboard API is unavailable and can still depend on browser permissions. Data stays in each browser; the LAN address has separate storage from localhost. Real iOS/Android validation remains pending.

## Bilingual workflow

Import the final bilingual PDF to read its original layout. To enable paragraphs and glossary, export a `.yuejian.json` bundle using [the BabelDOC adapter](docs/BABELDOC.md), then import it alongside the matching PDF. Existing bundle identifiers retain the preview's original name for compatibility. The adapter supports English→Chinese and Chinese→English jobs, nested glossaries, mixed batch folders, and legacy translation tracking. Versioned local catalogs can add papers or update bundles without replacing existing notes, bookmarks, or progress.

## Data and privacy

Public uploads are deliberately shared: PDFs, TXT files and reading bundles are stored in R2 (simulated when running locally), while D1 stores catalog metadata and account reading records. Public endpoints never return personal notes or uploader identities. Private documents use authenticated owner/admin file routes, with separate per-owner IDs and content hashes; identical files can have independent private and public copies. Private caches are excluded from the local-only library. Publication requires an explicit confirmation; original local files are not uploaded automatically. Uploaded files default to an 8 GB application storage budget, including in-flight uploads and withdrawn files. This is not an account-wide Cloudflare billing cap.

IndexedDB `yuejian-library` remains compatible: the `books` store retains local files and guest records, while per-account snapshots and pending edits live in `settings`. Switching accounts separates private records; guest-record merging is no longer exposed in the app. Clearing site data loses cached files and unsynced edits. Synced account records can be restored from the service. Markdown export is not a complete library backup.

Private samples, screenshots, generated assets, dependencies, build output, and local credentials are excluded from Git. **Vite still copies files under `public/` into builds even when Git ignores them.** `npm run build:cloud` writes `dist-cloud/` with an explicit asset allowlist, excluding all local samples; future deployment must still use a clean checkout and inspect the output. See [security and data handling](SECURITY.md).

## Project documentation

- [Architecture and storage](docs/ARCHITECTURE.md)
- [Cloudflare deployment and administration](docs/CLOUDFLARE.md)
- [BabelDOC bundle adapter](docs/BABELDOC.md)
- [Development and contribution guide](CONTRIBUTING.md)
- [Security and data handling](SECURITY.md)
- [Roadmap and validation status](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Third-party components](THIRD_PARTY.md)

## License status

No license has been selected for the original project code; package metadata uses `UNLICENSED`. Third-party components retain their respective licenses. Research papers and translations are separate from the application code and are not redistributed here.
