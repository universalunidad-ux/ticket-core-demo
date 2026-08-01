import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh",
  "utf8",
);

const contract = readFileSync(
  "tools/l130-authenticated-qa/edge-contract-http.mjs",
  "utf8",
);

test("replay compares canonical JSON values", () => {
  assert.match(
    contract,
    /canonicalJson\(replay\.body\) !== canonicalJson\(first\.body\)/u,
  );

  assert.doesNotMatch(
    contract,
    /JSON\.stringify\(replay\.body\) !== JSON\.stringify\(first\.body\)/u,
  );
});

test("canonical JSON recursively sorts objects", () => {
  assert.match(contract, /function canonicalJson\(value\)/u);
  assert.match(contract, /Object\.entries\(value\)[\s\S]*?\.sort/u);
  assert.match(contract, /Array\.isArray\(value\)/u);
});

test("ACL probe uses container psql only", () => {
  assert.doesNotMatch(
    contract,
    /spawnSync\(\s*"psql"/u,
  );

  assert.match(
    contract,
    /spawnSync\(\s*"docker"[\s\S]*?"exec"[\s\S]*?"psql"/u,
  );
});

test("runner exposes one local DB container identity", () => {
  assert.equal(
    (
      runner.match(
        /export TC_LOCAL_DB_CID="\$DB_CID"/gu,
      ) || []
    ).length,
    1,
  );

  assert.equal(
    (
      runner.match(
        /unset TC_LOCAL_DB_CID/gu,
      ) || []
    ).length,
    1,
  );
});

test("trap is fail-closed and preserves original errors", () => {
  assert.match(
    runner,
    /local final_rc="\$original_rc"/u,
  );

  assert.match(
    runner,
    /if \[\[ "\$final_rc" -eq 0 \]\][\s\S]*?final_rc=1/u,
  );

  assert.match(
    runner,
    /teardown \|\| true/u,
  );

  assert.match(
    runner,
    /exit "\$final_rc"/u,
  );
});

test("public replay and conflict contracts remain", () => {
  assert.match(contract, /E_SUPPORT_REPLAY/u);
  assert.match(contract, /TC_IDEMPOTENCY_KEY_REUSED/u);
  assert.match(
    contract,
    /successKeys !== "folio,ok,status,token_publico"/u,
  );
});
