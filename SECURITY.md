# Security and data handling / 安全与数据说明

## Current scope

Margina remains a local preview. A Cloudflare Worker now implements a public catalog and authenticated upload / personal-record APIs against locally simulated D1 and R2. Production resources, Access configuration and deployment have not been created. The preview binds to loopback.

Publishing is explicit: uploaded PDFs and reading bundles are public documents. Do not upload private research data. The Worker routes public downloads through a catalog visibility check; private reading records are scoped to the verified subject. Access JWT signatures, issuer, audience and expiry are verified with `jose`; user-supplied identity fields are never authoritative. Cookie-authenticated writes require an exact same-origin `Origin` header. Local test identities require explicit local environment flags and a loopback hostname, use signed HttpOnly cookies, and are disabled in the production configuration.

PDFs and notes are not end-to-end encrypted. Browser data is unencrypted IndexedDB and remains accessible to someone with access to the same browser profile; logout hides account records but does not erase the local cache. Keep each person's device/browser profile private. Clearing website data loses cached files and unsynced records. Markdown is not a complete restorable backup. New account writes use transactions, optional browser locks and server version checks; the legacy local-only editor still has its original stale-tab limitations.

An 8 GB application file budget reserves storage atomically before uploads; this is not an account-wide Cloudflare billing cap. Withdrawal hides future public downloads but keeps stored files and cannot revoke existing downloaded copies. Production login, load, maximum-size uploads and Cloudflare Free CPU limits require deployment-stage verification. See [Cloudflare scope and limitations](docs/CLOUDFLARE.md).

## Repository and build hygiene

- Do not commit PDFs, translation jobs, bundles, screenshots of private documents, secrets, or generated output.
- `public/samples/`, `public/pdf-assets/`, `artifacts/`, `dist/`, `dist-cloud/`, `.wrangler/`, `.dev.vars*`, `.env*` and common key formats are ignored.
- Git ignore rules do not filter build output. Vite copies `public/` into `dist/`, including private samples. For deployment use `npm run build:cloud`, whose asset allowlist excludes samples and produces `dist-cloud/`; build from a clean checkout and inspect files before publication.
- Do not expose local preview servers or add a deployment workflow as part of routine development.
- Do not place private papers in public issues, CI logs, release archives or workflow artifacts.

## Reporting

For a vulnerability, use GitHub's private vulnerability reporting option **if enabled** on the repository. If it is unavailable, ask the maintainer for a private contact method without publishing exploit details or private documents. No dedicated security inbox or response-time commitment has been established.

Include the affected commit, browser, reproduction steps and a synthetic / redistributable sample when possible. Do not send passwords, tokens, original research data or personal annotations.
