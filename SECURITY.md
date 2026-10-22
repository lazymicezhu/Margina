# Security and data handling / 安全与数据说明

## Current scope

Margina v0.1 is a local prototype, not a multi-user hosted service. PDFs and notes are stored unencrypted in the current browser's IndexedDB. There is no application authentication, remote backup, cloud sync, telemetry, or document-upload endpoint. The development / preview server listens on loopback by default.

Browser storage is not a durable backup: clearing website data, browser storage eviction, or switching origins may make the library unavailable. Markdown export contains note text and quotations, not a restorable copy of the entire library. Another tab can overwrite stale note state; cross-tab conflict handling is not yet implemented.

## Repository and build hygiene

- Do not commit PDFs, translation jobs, bundles, screenshots of private documents, secrets, or generated output.
- `public/samples/`, `public/pdf-assets/`, `artifacts/`, `dist/`, `.env*` and common key formats are ignored.
- Git ignore rules do not filter build output. Vite copies `public/` into `dist/`, including private samples. Build a future deployment from a clean checkout and inspect its files before publication.
- Do not expose local preview servers or add a deployment workflow as part of routine development.
- Do not place private papers in public issues, CI logs, release archives or workflow artifacts.

## Reporting

For a vulnerability, use GitHub's private vulnerability reporting option **if enabled** on the repository. If it is unavailable, ask the maintainer for a private contact method without publishing exploit details or private documents. No dedicated security inbox or response-time commitment has been established.

Include the affected commit, browser, reproduction steps and a synthetic / redistributable sample when possible. Do not send passwords, tokens, original research data or personal annotations.
