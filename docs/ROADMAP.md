# Roadmap and validation / 路线图与验证

## Available in the local preview

- Public catalog and account shelves, local Cloudflare Workers/D1/R2 service, verified-identity API boundary, explicit public uploads and private reading-record sync.
- Administrator library upload/withdrawal/restore/deletion and per-account notes.
- Responsive paper library and bilingual PDF view.
- Translation-job paragraph and glossary integration.
- Local highlights, notes, bookmarks and progress.
- Markdown export entry points.

## Next work

- Real iOS / Android checks: long-press selection, soft keyboard, zoom and download behavior.
- Complete browser download validation and add a restorable library backup format.
- Annotation migration between PDF revisions; improve legacy local-only cross-tab consistency.
- Storage maintenance for orphan files and restorable account backups.
- Better long-document navigation, search, accessibility and loading performance.
- Decide the original project's license.

## Later: Cloudflare and sync

The local implementation now includes static hosting configuration, authenticated APIs, a D1 database and R2 file storage, with version checks and conflict copies. Worker, D1 and R2 have been provisioned at the user’s request. Path-scoped Access and email-code login are configured. Next: validate an authenticated session, evaluate public-service upload quotas/rate limits, and test actual free-plan CPU/load and large files. Verify the actual free-tier limits at implementation time; no free-usage or cost guarantee is made by this prototype. The public site is deployed; the email-code login page is available.

## Validation baseline — 2026-10-22

- TypeScript and production build passed during initial development.
- Two local bilingual jobs (23 pages) passed hash, geometry and English-half rendering checks; these private fixtures are not in the repository.
- Browser mobile-dimension checks covered paragraph notes, glossary, PDF half-page rendering, text selection / highlights, zoom, page bookmarks and reload persistence.
- A PDF resize loop near scrollbar thresholds was fixed using a stable scrollbar gutter.
- Markdown download automation timed out; download completion remains unverified.
- Real mobile hardware testing and an automated UI regression suite remain pending.

## Public library validation — 2026-10-22

- Local Worker tests cover public/private access, same-origin writes, explicit publication, file hashes/deduplication, account isolation, compare-and-swap, shelf removal, withdrawal, matching bundles and storage budget.
- Merge tests cover independent edits, same-note conflicts, concurrent deletion, bookmark removals and backwards reading progress.
- Mobile-dimension browser checks cover upload, shelf actions, paragraph/PDF reading, notes/bookmarks and independent-browser account restoration, concurrent same-note edits, offline editing/reconnection and reload recovery. Widths 320/390/768 had no page overflow. Real Cloudflare login and mobile hardware remain unverified.

## Administrator update — 2026-10-23

Administrator endpoints and mobile layouts are implemented. Per user request, local runtime and browser tests were not run for this update; online checks confirm the public catalog and protected login redirects; authenticated backend interactions remain to be validated. Cloudflare deployment instructions and commands are available in `docs/CLOUDFLARE.md`.
