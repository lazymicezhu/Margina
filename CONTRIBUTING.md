# Contributing / 开发指南

## Local workflow

1. Use Node.js 22.13+ (`nvm use` with a compatible Node 22 installation).
2. Run `npm ci`, then `npm run dev`.
3. Keep edits focused; update both READMEs when features, setup or limitations change.
4. Run `npm run build` (includes TypeScript checks) before submitting changes.
5. For reader changes, verify the affected behavior in the local preview at phone and desktop widths.

There is no automated browser test suite yet. Do not report unrun checks as passing. A change involving annotations should check text selection, language switching, zoom, page navigation and reload persistence. For bundle work, validate original / PDF binding and failure cases with synthetic or redistributable fixtures. Use `npm audit` when changing dependencies and review findings.

## Pull requests

Explain the problem, resulting behavior and checks performed. Include non-sensitive screenshots for visual changes, and identify remaining limitations. Do not attach real private papers, translation jobs, personal notes or local screenshots containing them.

## Data and compatibility

Do not change `yuejian-library` or `yuejian-babeldoc-v1` without a migration plan. Preserve original PDF files. Exclude research data from commits, and remember that ignored `public/` files still enter Vite build output. Do not add credentials to environment examples or committed files.

## Deployment and licensing

CI builds only; it must not publish a site. Deployment requires a separate task and a clean build free of local samples. The original project code has no selected license yet; do not introduce third-party code without recording its origin and license.
