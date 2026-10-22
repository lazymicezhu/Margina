# Margina

**Read. Reflect. Connect.**

English | [简体中文](README.zh-CN.md)

A mobile-first web reader for bilingual academic papers, with highlights, notes, and reading progress stored in your browser. Margina reuses final PDFs, translation segments, and glossaries from the `academic-pdf-bilingual` workflow powered by BabelDOC. It does not translate papers or require an AI API key.

> **Local preview, v0.1.0.** No hosted demo, account system, cloud sync, or offline app cache is currently available. Cloudflare deployment is a future direction, not a completed feature.

## Features

- Import PDFs, deduplicate by SHA-256, search the library, and star papers.
- Read the Chinese half, English half, or full spread of a bilingual PDF.
- Switch to mobile-friendly paragraphs using a matching translation bundle; compare languages and consult the original glossary.
- Highlight PDF text, attach notes to pages or segments, and save bookmarks and progress.
- Request Markdown exports of notes. End-to-end browser download validation remains pending.

Paragraph mode uses intermediate translation segments. It can omit repeated content or later layout repairs; the final PDF remains authoritative for figures, formulas, footnotes, and revisions. Scanned PDFs can be rendered but do not gain selectable text or OCR.

## Quick start

Use **Node.js 22.13+** and npm. The `.nvmrc` selects Node 22; install the current patch version of that line.

```sh
git clone https://github.com/lazymicezhu/Margina.git
cd Margina
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build preview:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Open [the local preview](http://127.0.0.1:4173/). Both servers listen on loopback by default; this address is not reachable from a separate phone. Responsive layout has been checked at mobile browser dimensions, but real iOS/Android interactions still need testing.

A fresh clone starts with an empty library. Import your own PDF; no research papers or translation jobs are included in the repository. Sample loading is optional and local only.

## Bilingual workflow

Import the final bilingual PDF to read its original layout. To enable paragraphs and glossary, export a `.yuejian.json` bundle using [the BabelDOC adapter](docs/BABELDOC.md), then import it alongside the matching PDF. Existing bundle identifiers retain the preview's original name for compatibility.

## Data and privacy

PDFs, notes, bookmarks, and progress live in IndexedDB on the current browser and origin. There is no application backend or automatic upload. Clearing site data removes the library; another browser, host, or port has separate storage. Markdown export is not a complete library backup and cannot currently be imported to restore notes.

Private samples, screenshots, generated assets, dependencies, build output, and local credentials are excluded from Git. **Vite still copies files under `public/` into builds even when Git ignores them.** Any future deployment must use a clean checkout without private samples. See [security and data handling](SECURITY.md).

## Project documentation

- [Architecture and storage](docs/ARCHITECTURE.md)
- [BabelDOC bundle adapter](docs/BABELDOC.md)
- [Development and contribution guide](CONTRIBUTING.md)
- [Security and data handling](SECURITY.md)
- [Roadmap and validation status](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Third-party components](THIRD_PARTY.md)

## License status

No license has been selected for the original project code; package metadata uses `UNLICENSED`. Third-party components retain their respective licenses. Research papers and translations are separate from the application code and are not redistributed here.
