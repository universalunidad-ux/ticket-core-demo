# Local distribution inventory

> Generated from `governance/distribution-contract.json` and tracked entrypoints by `tools/generate-distribution-inventory.mjs`; do not edit manually.

Entrypoints: **15**
Resolved local references: **143**

## Runtime probe routes

- `/`
- `/app/index.html`
- `/app/tickets.html?readonly=1`
- `/app/sw.js`
- `/site.webmanifest`

## Safety contract

- Authorization and Supabase API routes bypass caches.
- Non-versioned requests use `cache: no-store`.
- Public config exposes only URL and publishable key fields.
- Readonly demo fallback is restricted to localhost.
