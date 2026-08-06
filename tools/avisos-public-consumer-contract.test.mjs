import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    new URL(
      "../app/soporte.js",
      import.meta.url,
    ),
    "utf8",
  );

const loaderMatch =
  source.match(
    /const loadGlobalNotice=async\(\)=>\{[\s\S]*?\n\};/,
  ) ??
  source.match(
    /const loadGlobalNotice=async\(\)=>\{[\s\S]*?\};/,
  );

assert.ok(
  loaderMatch,
  "loadGlobalNotice was not found",
);

const loader =
  loaderMatch[0];

test(
  "public support notices use the bounded RPC",
  () => {
    assert.ok(
      loader.includes(
        'supabase.rpc("tc_public_support_notices",{p_limit:1})',
      ),
    );
  },
);

test(
  "public support no longer queries avisos_globales directly",
  () => {
    assert.equal(
      source.includes(
        'supabase.from("avisos_globales")',
      ),
      false,
    );
  },
);

test(
  "RPC tabular response is reduced to one notice",
  () => {
    assert.ok(
      loader.includes(
        "Array.isArray(data)?data[0]||null:data||null",
      ),
    );
  },
);

test(
  "client-side publishability defense remains present",
  () => {
    assert.ok(
      loader.includes(
        "renderNotice(isPublishableNotice(notice)?notice:null)",
      ),
    );
  },
);

test(
  "failure remains fail-closed",
  () => {
    assert.ok(
      loader.includes(
        'console.warn("SUPPORT_NOTICE_LOAD_ERROR",err)',
      ),
    );

    assert.ok(
      loader.includes(
        "renderNotice(null)",
      ),
    );
  },
);
