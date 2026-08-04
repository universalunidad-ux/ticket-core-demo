import assert from "node:assert/strict";
import fs from "node:fs";

const runner = fs.readFileSync(
  "tools/local-db/run-media-video-docker-runtime.sh",
  "utf8",
);

const seed = fs.readFileSync(
  "supabase/tests/media_video_local_fixture_seed.sql",
  "utf8",
);

const teardown = fs.readFileSync(
  "supabase/tests/media_video_concurrency_teardown.sql",
  "utf8",
);

for (const marker of [
  "FIXTURE_TICKET_ID",
  "FIXTURE_ACTOR_ID",
  "media_video_local_fixture_seed.sql",
  "MEDIA_LOCAL_FIXTURE_SEED_FAILED",
  "FIXTURE_MODE=SYNTHETIC_LOCAL_ONLY",
]) {
  assert.ok(
    runner.includes(marker),
    `runner marker missing: ${marker}`,
  );
}

for (const marker of [
  "set_config(",
  "tc.fixture_actor_id",
  "tc.fixture_ticket_id",
  "current_setting('tc.fixture_actor_id')",
  "current_setting('tc.fixture_ticket_id')",
  "insert into auth.users",
  "insert into public.perfiles",
  "insert into public.tickets",
]) {
  assert.ok(
    seed.includes(marker),
    `seed marker missing: ${marker}`,
  );
}

assert.doesNotMatch(
  seed,
  /do\s+\$fixture\$[\s\S]*?:'(?:actor_id|ticket_id)'/i,
  "psql variables must not appear inside fixture DO blocks",
);

for (const marker of [
  "delete from public.tickets",
  "delete from public.perfiles",
  "delete from auth.users",
  "tc-media-video-runtime",
]) {
  assert.ok(
    teardown.includes(marker),
    `teardown marker missing: ${marker}`,
  );
}

assert.equal(
  (
    runner.match(
      /-v actor_id="\$FIXTURE_ACTOR_ID"/g,
    ) ?? []
  ).length,
  3,
  "actor_id must be passed to seed and both teardown calls",
);

for (const text of [runner, seed, teardown]) {
  assert.doesNotMatch(
    text,
    /\b(git push|supabase link|supabase db push|functions deploy)\b/i,
  );
}

console.log(JSON.stringify({
  fixture: "synthetic-local-only",
  variableScope: "set_config/current_setting",
  preflight: "PASS",
  remoteOperations: false,
  result: "PASS",
}));
