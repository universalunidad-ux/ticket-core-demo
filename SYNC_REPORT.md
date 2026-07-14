# Ticket Core public demo sync report

STATUS: PREPARED_LOCALLY_WITH_BLOCKERS
SOURCE_HEAD: 11f5440211fc1376bf4ba8069c4fcb39dc8fca49
SOURCE_BRANCH: codex/windows-v3-launcher
SOURCE_WORKTREE_CLEAN: YES
SOURCE_INDEX_EMPTY: YES
PUBLIC_REPOSITORY: universalunidad-ux/ticket-core-demo
PUBLIC_BASE_HEAD: 8865d3d2b5ef4ca75d01ad7c754aa3abff81b4b0
SYNC_BRANCH: sync/ticket-core-v3-20260714
FILES_ADDED: 30 total Git additions (24 app source additions plus public assets and audit artifacts)
FILES_MODIFIED: 28
FILES_DELETED: 3
FILES_EXCLUDED: 1
LATEST_LOGIN_SYNCED: YES
XSS_FIX_SYNCED: YES
SUPABASE_PUBLIC_CONFIG_PRESENT: YES
SUPABASE_LOCAL_CONFIG_PRESENT: NO
SERVICE_ROLE_KEYS: 0
PRIVATE_KEYS: 0
DATABASE_PASSWORDS: 0
SECRET_SCAN: PASS
PII_SCAN: PASS
PII_FILES: 0
JANOME_STATUS: SAFE_BROWSER_MODULES_SYNCED; enriched JSON absent; Node enrichment generator excluded
JANOME_LICENSE_EVIDENCE: BLOCKED_INSUFFICIENT_EVIDENCE for independent provenance of the source-provided brand catalog/image
PAGES_BASE_PATH: /ticket-core-demo/
BROKEN_REFERENCES: 0
PAGES_SUBPATH_GATE: PASS
PUBLIC_BACKEND_GATE: BLOCKED_INSUFFICIENT_EVIDENCE
RLS_EVIDENCE: Local schema/documentation is partial and does not prove deployed RLS, grants, role boundaries, Storage policies, or tenant isolation.
EDGE_FUNCTIONS_EVIDENCE: Eight local function sources were reviewed; deployed names, versions, secrets, authorization behavior, and parity were not inspected.
CORS_STATUS: Relevant local function sources include OPTIONS/CORS handling; deployed behavior for the GitHub Pages origin is unverified.
AUTH_REDIRECT_STATUS: BLOCKED_INSUFFICIENT_EVIDENCE; remote Auth redirect settings were not inspected.
XSS_GATE: PASS
XSS_CASES: 20/20
LOCAL_COMMIT: SELF (resolve with `git rev-parse HEAD` after this report is committed)
WORKTREE_CLEAN: EXPECTED_AND_VERIFIED_AFTER_LOCAL_COMMIT
INDEX_EMPTY: EXPECTED_AND_VERIFIED_AFTER_LOCAL_COMMIT
PUSH_PERFORMED: NO
MAIN_MODIFIED: NO
SUPABASE_REMOTE_TOUCHED: NO
READY_FOR_PUBLIC_PUSH: NO
BLOCKERS: Deployed Supabase RLS/grants/Storage/Edge Function parity/Auth redirects were not evidenced; authenticated functional flows were intentionally not run; Janome asset/catalog license provenance was not independently documented.
NEXT_SAFE_ACTION: Obtain read-only deployed Supabase security evidence and license provenance, then run authorized synthetic-account tests before any push.

## Full app matrix totals

SOURCE_APP_FILES: 58
PUBLIC_APP_FILES_BEFORE: 37
FILES_IDENTICAL: 8
FILES_ADDED: 24
FILES_UPDATED: 7
FILES_DELETED: 3
FILES_EXCLUDED: 1
PAGES_OVERRIDES: 24
PUBLIC_APP_FILES_AFTER: 58
UNEXPLAINED_SOURCE_OMISSIONS: 0
UNEXPLAINED_PUBLIC_EXTRAS: 0
MIXED_OLD_NEW_IMPLEMENTATIONS: 0

FULL_APP_SYNC_GATE: PASS
HTML_SYNC_GATE: PASS
JAVASCRIPT_SYNC_GATE: PASS
CSS_SYNC_GATE: PASS
OBSOLETE_FILES_GATE: PASS

The complete per-file SHA-256 record is in `SYNC_MATRIX.tsv`. Counts above classify actions against the public base. `PAGES_OVERRIDES` counts all source files whose final public bytes intentionally differ from source; some were newly added and therefore remain classified as `ADD` in the action column.

## Documented public differences

1. `app/alta-cliente.html` — loads the audited public Supabase configuration.
2. `app/cliente.html` — loads the audited public Supabase configuration.
3. `app/clientes.html` — loads the audited public Supabase configuration.
4. `app/consolidacion-clientes.html` — loads the audited public Supabase configuration.
5. `app/dashboard.html` — loads the audited public Supabase configuration.
6. `app/estado.html` — loads the audited public Supabase configuration.
7. `app/index.html` — static Pages entry behavior, public config, and safe-demo link.
8. `app/soporte.html` — loads the audited public Supabase configuration.
9. `app/ticket.html` — loads the audited public config and uses Pages-compatible service-worker registration.
10. `app/tickets.html` — loads the audited public Supabase configuration.
11. `app/dashboard.js` — backend error objects are not written to the public console.
12. `app/estado.js` — public console output does not expose request/error details.
13. `app/global.js` — public diagnostics and local-only behavior are sanitized.
14. `app/index.js` — public login errors are neutral and a missing session remains silent.
15. `app/janome/janome_ticket.js` — safe asset paths and no enriched/private JSON dependency.
16. `app/notif-sound-test.js` — public console output is sanitized.
17. `app/shared/errors.js` — local debug mode is disabled.
18. `app/soporte.js` — no enriched/private Janome data dependency; diagnostics sanitized.
19. `app/sw.js` — Pages-compatible cache scope and sanitized diagnostics.
20. `app/ticket-assignment.js` — backend error objects are not written to the public console.
21. `app/ticket-composer-polish.js` — backend error objects are not written to the public console.
22. `app/ticket.js` — safe public assets and sanitized backend diagnostics.
23. `app/tickets-assignment.js` — backend error objects are not written to the public console.
24. `app/tickets.js` — synthetic read-only demo, XSS escaping, no dangerous debug exports, and sanitized diagnostics.

`app/supabase.config.public.js` is the one public-only app file. It contains exactly `supabaseUrl` and `supabasePublishableKey`; values are deliberately omitted here. `app/janome/enriquecer.js` is the one explained source omission because it is a Node-only enrichment generator, not browser runtime code.

## Validation evidence

- JavaScript syntax: PASS, 34 files.
- HTML/local asset references: PASS, 13 HTML files, 0 broken references, 0 duplicate IDs.
- CSS structure: PASS, 12 files.
- Git whitespace check: PASS.
- Source maps: 0.
- Localhost, `file://`, workstation paths, and private-repository references: 0.
- Required local assets requested during browser QA: HTTP 200/304; no mandatory asset 404.
- Sensitive console logs: 0 after review; operational labels/counts remain, backend error objects and payloads are not logged.
- Secret patterns: private keys 0, Supabase secret/service-role keys 0, GitHub tokens 0, database URLs 0, JWTs 0, password assignments 0, high-entropy text candidates 0.
- PII pattern matches were manually classified as generic placeholders, public organizational legal/contact text, or numeric false positives; no client/person dataset is included.
- XSS harness: 5 payload classes across 4 ticket renderers, 20/20 escaped.

## Functional test scope

- Root Pages entry and login UI: PASS.
- Safe demo without session: PASS; 45 synthetic tickets loaded and detail navigation remained blocked.
- Tickets demo: PASS.
- Support and ticket-status pages: PASS for static load and required assets.
- Incorrect credentials: NOT RUN because it would contact remote Auth while this task prohibits touching remote Supabase.
- Synthetic authenticated login, Ticket, Dashboard, Clients, and logout: BLOCKED_NOT_AUTHORIZED; no authorized synthetic account or deployed security evidence was supplied.
- Support submission, status lookup, ticket creation, uploads, and administrative mutations: NOT RUN; no remote data was created or changed.
