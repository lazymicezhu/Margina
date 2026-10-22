# Margina

**Read. Reflect. Connect.**

English | [简体中文](README.zh-CN.md)

A mobile-first web reader for bilingual academic papers, with highlights, notes, and reading progress stored in your browser. Margina reuses final PDFs, translation segments, and glossaries from the `academic-pdf-bilingual` workflow powered by BabelDOC. It does not translate papers or require an AI API key.

> **v0.1.0.** Public library, account sync and an administrator console are implemented for Cloudflare Workers / D1 / R2. Follow the [deployment guide](docs/CLOUDFLARE.md) to publish directly; no local preview or Git push is required. The public site is deployed at https://margina.lazymicezhu.com with D1 and private R2 storage; email-code login and the administrator console are enabled.

## Features

- Browse and read the public library without signing in. Signed-in users can explicitly publish PDFs / matching reading bundles and collect papers on a personal shelf.
- Separate each account’s notes, highlights, bookmarks and progress; synchronize changes with version checks, conflict copies, deletion tracking and a persistent local queue. Removing a shelf item preserves notes and the public file.
- Retain the original local-only library under Settings → Local documents; existing files are never automatically published.

- Import PDFs, deduplicate by SHA-256, search the library, and star papers.
- Use the PDF.js compatibility build for Safari. Public PDF caches are checked before reading and replaced if unreadable or mismatched, preserving notes and progress; failed reads offer a reload action.
- Read the Chinese half, English half, or full spread of a bilingual PDF. PDF rendering follows screen pixel density and redraws after pinch zoom, within a bounded bitmap memory budget; low-resolution scans retain their source detail.
- Open in the original PDF by default, with the Chinese half selected for bilingual papers, even when a reading bundle is present. Manually switch to mobile-friendly paragraphs using a matching translation bundle; compare languages and consult the original glossary.
- Highlight PDF text, attach notes to pages or segments, and save bookmarks and progress.
- Use a quiet, borderless interface with automatic light/dark appearance, collapsible explanations, and copyable notes. Copy confirmation fades after 2.5 seconds; reduced-motion preferences are respected. PDF artwork keeps its original colors.
- Request Markdown exports of notes. End-to-end browser download validation remains pending.

Paragraph mode uses intermediate translation segments. It can omit repeated content or later layout repairs; the final PDF remains authoritative for figures, formulas, footnotes, and revisions. Scanned PDFs can be rendered but do not gain selectable text or OCR.

## Cloudflare deployment

Follow the [step-by-step guide](docs/CLOUDFLARE.md) to create D1/R2, configure email login and set `ADMIN_EMAILS`. The `/admin` console provides account notes and library upload, withdrawal, restore and deletion. Production commands use an ignored `wrangler.production.jsonc` copy; `npm run deploy:cloud` builds and deploys without a Git push.

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

`npm run dev` still starts the frontend-only Vite server. Without the local Worker, the public library reports an unavailable service; Settings → Local documents remains usable. For a frontend-only production build preview:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Open [the local preview](http://127.0.0.1:4173/). Both servers listen on loopback by default; this address is not reachable from a separate phone. Responsive layout has been checked at mobile browser dimensions, but real iOS/Android interactions still need testing.

A fresh clone starts with an empty public library. Log into a local test account and use Upload to publish a shareable PDF to the local service. For private files, use Settings → Local documents and import there. No research papers or translation jobs are included in the repository. Optional samples are confined to the local-only library.


### Preview over Wi-Fi

After building, run `npm run preview -- --host 0.0.0.0 --port 4180 --strictPort`. Connect your phone to the same Wi-Fi and open `http://<computer-LAN-IP>:4180`. Keep the computer awake and the preview process running. Use a trusted local network: files bundled from `public/`, including local samples, are available to devices that can reach this port. This is a local preview, not a public deployment.

HTTP LAN access supports PDF hashing and annotation IDs through browser-side fallbacks; copying notes uses the browser's legacy copy action when the Clipboard API is unavailable and can still depend on browser permissions. Data stays in each browser; the LAN address has separate storage from localhost. Real iOS/Android validation remains pending.

## Bilingual workflow

Import the final bilingual PDF to read its original layout. To enable paragraphs and glossary, export a `.yuejian.json` bundle using [the BabelDOC adapter](docs/BABELDOC.md), then import it alongside the matching PDF. Existing bundle identifiers retain the preview's original name for compatibility. The adapter supports English→Chinese and Chinese→English jobs, nested glossaries, mixed batch folders, and legacy translation tracking. Versioned local catalogs can add papers or update bundles without replacing existing notes, bookmarks, or progress.

## Data and privacy

Public uploads are deliberately shared: PDFs and reading bundles are stored in R2 (simulated when running locally), while D1 stores catalog metadata and account reading records. Public endpoints never return personal notes or uploader identities. Publication requires an explicit confirmation; original local files are not uploaded automatically. Uploaded files default to an 8 GB application storage budget, including in-flight uploads and withdrawn files. This is not an account-wide Cloudflare billing cap.

IndexedDB `yuejian-library` remains compatible: the `books` store retains local files and guest records, while per-account snapshots and pending edits live in `settings`. Switching accounts separates private records; guest records are merged only through an explicit setting. Clearing site data loses cached files and unsynced edits. Synced account records can be restored from the service. Markdown export is not a complete library backup.

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
