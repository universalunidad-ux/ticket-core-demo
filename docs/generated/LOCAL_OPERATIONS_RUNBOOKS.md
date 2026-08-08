# Local operations runbooks

> Generated from `governance/operations-contract.json` by `tools/generate-operations-inventory.mjs`; do not edit manually. These procedures authorize local-only actions.

## OPS-LOCAL-DB-MIGRATION — Local migration failure

Trigger: A local migration or SQL contract exits non-zero.

### Diagnose

1. Capture the failing migration name and semantic error code.
2. Confirm the command targeted only the ephemeral local project id.

### Contain

1. Stop later migrations and dependent tests.
2. Do not link, push, or contact a remote Supabase project.

### Recover

1. Tear down the ephemeral local stack without retaining fixtures.
2. Fix only the owning migration or contract before starting a fresh local stack.

### Verify

1. Apply every migration from an empty local database.
2. Run SQL contracts, fixture rollback, teardown, and residual scan.

### Evidence

1. runtime/migrations.log
2. runtime/sql-contracts.log
3. teardown/teardown.log
4. residues/residual-scan.json

## OPS-LOCAL-EVIDENCE-FAILURE — Evidence or gate failure

Trigger: A targeted gate, preflight, or evidence validator exits non-zero.

### Diagnose

1. Record the exact command, exit status, HEAD, and first semantic failure marker.
2. Check index locks and worktree cleanliness without deleting or bypassing either.

### Contain

1. Do not run the full regression again.
2. Do not promote any row whose required evidence is incomplete.

### Recover

1. Correct only the owning source or generated artifact.
2. Regenerate documentation from its canonical machine-readable source.

### Verify

1. Rerun the failed targeted owner.
2. Run preflight in the mode required by the checkpoint.

### Evidence

1. targeted/targeted.log
2. preflight/preflight.log
3. residues/worktree-status.txt

## OPS-LOCAL-DISTRIBUTION — Local distribution contract failure

Trigger: The local artifact, service worker, readonly, or missing-backend contract fails.

### Diagnose

1. Identify the first missing tracked asset or unsafe cache route.
2. Confirm public config contains no privileged credential.

### Contain

1. Do not publish, push, deploy, or claim hosted evidence.
2. Keep the last validated local artifact available for comparison.

### Recover

1. Regenerate the local distribution inventory from tracked files.
2. Repair only the failing cache, config, or entrypoint contract.

### Verify

1. Run distribution targeted tests against exact HEAD.
2. Confirm teardown and zero listener/process residue.

### Evidence

1. distribution/distribution-contract.json
2. targeted/distribution.log
3. teardown/teardown.log
