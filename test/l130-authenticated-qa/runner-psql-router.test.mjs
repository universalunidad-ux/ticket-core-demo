import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh",
  "utf8",
);

test("exactly one psql router exists", () => {
  assert.equal(
    (
      runner.match(
        /^psql\(\)[ \t]*\{/gm,
      ) || []
    ).length,
    1,
  );
});

test("both existing callsites use the same router", () => {
  assert.equal(
    (
      runner.match(
        /^[ \t]*psql "\$LOCAL_DATABASE_URL"[ \t]*\\/gm,
      ) || []
    ).length,
    2,
  );
});

test("router executes PostgreSQL only inside the DB container", () => {
  assert.match(
    runner,
    /docker exec -i "\$DB_CID"[\s\S]*psql -U postgres -d postgres/,
  );
});

test("container id is derived from bootstrap output", () => {
  assert.match(runner, /BOOTSTRAP_CID/);
  assert.match(runner, /E_BOOTSTRAP_CID_INVALID/);
  assert.match(runner, /E_DB_CONTAINER_NOT_RUNNING/);
});

test("SQL file arguments are streamed through stdin", () => {
  assert.match(
    runner,
    /"\$\{args\[@\]\}" < "\$sql_file"/,
  );

  assert.match(
    runner,
    /E_PSQL_INPUT_FILE_MISSING/,
  );
});

test("router rejects incorrect database routing", () => {
  assert.match(runner, /E_PSQL_URL_MISSING/);
  assert.match(runner, /E_PSQL_URL_MISMATCH/);
  assert.match(runner, /E_MULTIPLE_PSQL_FILES/);
});

test("control-plane evidence remains intact", () => {
  assert.match(runner, /00-runner-started\.env/);
  assert.match(runner, /00-phase\.env/);
  assert.match(runner, /00-final-failure\.env/);
  assert.match(runner, /TC_CANONICAL_BRANCH/);
  assert.match(runner, /TC_CANONICAL_HEAD/);
});
