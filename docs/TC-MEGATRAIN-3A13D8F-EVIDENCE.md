# TC-3A13D8F local vertical ledger megatrain

This package records local-only evidence for the isolated branch based on
`3a13d8f411d11961eb834ce047001bb6f7410934`. It makes no staging, production,
push, deploy, or formal-ledger adoption claim. Runtime artifacts are stored
outside the repository under `outputs/TC-3A13D8F-MEGATRAIN-20260802/` and were
scanned/redacted before handoff.

## Wagon 1 — database owner

- Commit: `24b75d35e7425c6e040421cd6527a5d49a2af164`.
- Files: one new migration and one isolated SQL contract test.
- Contract: `public.v_janome_dashboard_agentes`, `security_invoker=true`, admin
  predicate, bounded columns, exact revokes/grant, and postconditions.
- Static mutations: missing security invoker, admin predicate, and anon revoke
  were rejected.
- Local PostgreSQL: migrations, admin visibility, support/client isolation and
  rollback passed; zero fixture rows/users remained; teardown passed.

## Wagon 2 — administrative consumer

- Commit: `a9bcf1df2fccd9c3428e6903836987e6542f8083`.
- Files: `app/dashboard.js` and an isolated admin contract test.
- Contract: bounded view query, exact field mapping, loading/empty/error/retry,
  last-known-good behavior, modal focus restoration and sensitive-data boundary.
- Gates: frontend, U10, U15A2 agent summary/supervision, U15A3 bitacora and
  targeted admin tests passed.

## Wagon 3 — nominal AuthZ runtime

- Commit: `5b1327f3774e465a0fc9d090de545c506cb09363`.
- Files: one local-only runner and two isolated test/fixture files.
- Runtime: seven surfaces, 16 negative cases and eight mutations passed. The
  local policy inventory gate passed against an exported local snapshot.
- Rollback: fixture transaction rolled back; residual rows/users were zero;
  teardown and container-residue checks passed.
- Evidence: `runtime-authz/`.

## Wagon 4 — canonical A11Y audit

- Commit: this document is part of `fix(a11y): close canonical page audit findings`.
- Files: six canonical HTML pages, one isolated auditor and one mutation suite.
- Before: 14 pages, P1=2, P2=10.
- After: 14/14 pages pass the deterministic audit, P1=0, P2=0.
- Mutations: 13/13 rule mutations fail as expected.
- Browser quickpass: automated PASS across the exact 14-page inventory; internal
  routes redirected to the login guard, public routes rendered without duplicate
  IDs or horizontal overflow, and the public theme control toggled once.
- Human visual/screen-reader review: PENDING and not represented as automatic PASS.
- Comparative commit `07adaaa3e12dd74da4d25f979768f0f34bd2a658`:
  `PARTIALLY_REUSED`. Its four explicit button-type corrections coincide with
  this candidate. Its additional canonical-tool and ticket-CSS changes were not
  cherry-picked or claimed by this unit.
- Evidence: `a11y-before/` and `a11y-after/` (one JSON per page plus summary).

## Cumulative gates and runtime

- New megatrain tests: 32/32 PASS.
- Frontend gates: PASS (392 files).
- Canonical A11Y static gate: PASS (4 suites).
- Page-access contract: PASS (14 pages; 19/19 mutants rejected).
- Admin and security targeted contracts: PASS.
- Functional contract runner: PASS (positive=54, negative=166, sensitivity=16).
- B130 Auth E2E: `B130_003_EDGE_E2E=PASS`,
  `B130_004_EDGE_E2E=PASS`, teardown PASS, residual rows/users zero.
- B130 evidence: `b130-auth-e2e/`.
- A pre-commit full-test attempt correctly failed the U15D cleanliness guard
  because the A11Y HTML candidate was staged. It is not treated as regression
  evidence; the clean-HEAD full result is reported in the final handoff.

## Ledger projection (proposal only)

Ledger source SHA-256 was verified as
`cd90ca0afa19665ebf3181012a5a248123dfbfc87983efd8868eb0781e49a9c8`.
The formal ledger was not modified. The proposal starts from the already
adjudicable `146.70` base and excludes the earlier `+7.20` delta.

- `TC-U035`: +0.30 for the locally tested missing agent view.
- `TC-U010` and `TC-U011`: +0.90 combined for the expanded nominal matrix.
- `A11Y-001..A11Y-013`: +3.90 conservative automated promotion.
- `TC-U062`: +0.15 for closure of the recorded deterministic findings.
- Net newly adjudicable proposal: +5.25.
- Proposed total: 151.95 / 317 = 47.93%.
- Additional 0.45 remains blocked on human A11Y review; it is not credited.
- B130 and previously adjudicated Auth M1 evidence are not re-counted.

This is a projection for formal review, not a ledger patch or adoption record.
