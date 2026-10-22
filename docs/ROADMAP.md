# Roadmap and validation / 路线图与验证

## Available in the local preview

- Responsive paper library and bilingual PDF view.
- Translation-job paragraph and glossary integration.
- Local highlights, notes, bookmarks and progress.
- Markdown export entry points.

## Next work

- Real iOS / Android checks: long-press selection, soft keyboard, zoom and download behavior.
- Complete browser download validation and add a restorable library backup format.
- Cross-tab state consistency and annotation migration between PDF revisions.
- Better long-document navigation, search, accessibility and loading performance.
- Decide the original project's license.

## Later: Cloudflare and sync

Evaluate static hosting, authenticated APIs, a notes database and PDF object storage. Define authorization, conflict resolution, deletion and recovery before enabling cross-device sync. Verify the actual free-tier limits at implementation time; no free-usage or cost guarantee is made by this prototype. No deployment or cloud resources have been provisioned.

## Validation baseline — 2026-10-22

- TypeScript and production build passed during initial development.
- Two local bilingual jobs (23 pages) passed hash, geometry and English-half rendering checks; these private fixtures are not in the repository.
- Browser mobile-dimension checks covered paragraph notes, glossary, PDF half-page rendering, text selection / highlights, zoom, page bookmarks and reload persistence.
- A PDF resize loop near scrollbar thresholds was fixed using a stable scrollbar gutter.
- Markdown download automation timed out; download completion remains unverified.
- Real mobile hardware testing and an automated UI regression suite remain pending.
