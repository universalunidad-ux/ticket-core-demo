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
  const observed = {
    selectColumn: "",
    selectValue: "",
    insertValue: null as { scope: string; key_hash: string } | null,
  };
  const sb = {
    from: (_table: string) => ({
      select: (_columns: string, _options: { count: "exact"; head: true }) => {
        if (throwOnSelect) throw new Error("select rejected");
        return {
          eq: (_firstColumn: string, _firstValue: string) => ({
            eq: (secondColumn: string, secondValue: string) => {
              observed.selectColumn = secondColumn;
              observed.selectValue = secondValue;
              return {
                gte: async (_dateColumn: string, _since: string) => ({
                  count,
                  error: selectError,
                }),
              };
            },
          }),
        };
      },
      insert: async (value: { scope: string; key_hash: string }) => {
        inserts++;
        observed.insertValue = value;
        if (throwOnInsert) throw new Error("insert rejected");
        return { error: insertError };
      },
    }),
  };
  return { sb, observed, get inserts() { return inserts; } };
};

Deno.test("permite e inserta", async () => {
  const client = makeClient();
  assert(
    await rateLimit(client.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10),
    "debe permitir",
  );
  assert(client.inserts === 1, "debe insertar una vez");
  assert(client.observed.selectColumn === "key_hash", "debe consultar key_hash");
  assert(/^[a-f0-9]{64}$/.test(client.observed.selectValue), "hash completo");
  assert(
    client.observed.insertValue?.key_hash === client.observed.selectValue,
    "consulta e inserción deben usar el mismo hash",
  );
  assert(
    !JSON.stringify(client.observed).includes("203.0.113.10:EX-42"),
    "nunca debe persistir la llave cruda",
  );
});

Deno.test("SHA-256 es determinista y separa discriminadores", async () => {
  const first = makeClient();
  const second = makeClient();
  const other = makeClient();
  await rateLimit(first.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10);
  await rateLimit(second.sb, "portal_reply", "203.0.113.10:EX-42", 8, 10);
  await rateLimit(other.sb, "portal_reply", "203.0.113.11:EX-42", 8, 10);
  assert(first.observed.selectValue === second.observed.selectValue, "determinista");
  assert(first.observed.selectValue !== other.observed.selectValue, "sin colisión trivial");
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
