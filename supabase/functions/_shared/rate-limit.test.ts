import { rateLimit } from "./rate-limit.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const makeClient = ({
  count = 0,
  selectError = null,
  insertError = null,
  throwOnSelect = false,
  throwOnInsert = false,
}: {
  count?: number | null;
  selectError?: unknown;
  insertError?: unknown;
  throwOnSelect?: boolean;
  throwOnInsert?: boolean;
} = {}) => {
  let inserts = 0;
  const sb = {
    from: (_table: string) => ({
      select: (_columns: string, _options: { count: "exact"; head: true }) => {
        if (throwOnSelect) throw new Error("select rejected");
        return {
          eq: (_firstColumn: string, _firstValue: string) => ({
            eq: (_secondColumn: string, _secondValue: string) => ({
              gte: async (_dateColumn: string, _since: string) => ({
                count,
                error: selectError,
              }),
            }),
          }),
        };
      },
      insert: async (_value: { scope: string; key: string }) => {
        inserts++;
        if (throwOnInsert) throw new Error("insert rejected");
        return { error: insertError };
      },
    }),
  };
  return { sb, get inserts() { return inserts; } };
};

Deno.test("permite e inserta", async () => {
  const client = makeClient();
  assert(
    await rateLimit(client.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "debe permitir",
  );
  assert(client.inserts === 1, "debe insertar una vez");
});

Deno.test("deniega al alcanzar el límite sin insertar", async () => {
  const client = makeClient({ count: 8 });
  assert(
    !await rateLimit(client.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "debe denegar",
  );
  assert(client.inserts === 0, "no debe insertar");
});

Deno.test("error SELECT falla cerrado", async () => {
  const client = makeClient({ count: null, selectError: new Error("select") });
  assert(
    !await rateLimit(client.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "debe denegar",
  );
  assert(client.inserts === 0, "no debe insertar");
});

Deno.test("error INSERT falla cerrado", async () => {
  const client = makeClient({ insertError: new Error("insert") });
  assert(
    !await rateLimit(client.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "debe denegar",
  );
});

Deno.test("excepciones no escapan", async () => {
  const selectClient = makeClient({ throwOnSelect: true });
  const insertClient = makeClient({ throwOnInsert: true });
  assert(
    !await rateLimit(selectClient.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "excepción SELECT debe denegar",
  );
  assert(
    !await rateLimit(insertClient.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "excepción INSERT debe denegar",
  );
});
