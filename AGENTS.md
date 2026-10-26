# Margina repository guidance

- Canonical local project directory: `/Users/lazymice/Library/Mobile Documents/com~apple~CloudDocs/重要:常用文件备份/Lazymice/Margina`. Make all future project edits and run project commands here unless the user explicitly requests another location.
- The former `/Users/lazymice/Documents/Codex/2026-10-22/github/yuejian` path is a compatibility symlink to this directory. Keep it pointing here; do not replace it with an independent checkout or edit the `yuejian.backup-before-migration-20261022` backup.
- Build a mobile-first bilingual academic reader. Keep UI text primarily Chinese and product branding Margina.
- Read README.md and docs/ARCHITECTURE.md before changing architecture; update both READMEs for user-facing setup, feature or limitation changes.
- Preserve IndexedDB `yuejian-library` and bundle `yuejian-babeldoc-v1` compatibility unless implementing a documented migration.
- Never commit real papers, translation jobs, bundles, private screenshots, credentials, node_modules or dist. Ignored public files still enter Vite builds.
- The final PDF is authoritative. Paragraph segments are incomplete intermediate artifacts; do not present them as verified full text.
- Check affected reader behavior at mobile dimensions. Run npm run build for source changes; report checks actually performed and remaining gaps.
- GitHub Actions checks builds; Cloudflare Workers Builds is the production deployment path from `main` once connected. Pushing `main` can update the live site: only push or deploy when the user requests it. Keep local previews local; do not publish via Sites or provision cloud services without an explicit request.
- Prefer focused implementation over unnecessary framework or dependency changes. Do not spawn agents unless the user explicitly asks.
