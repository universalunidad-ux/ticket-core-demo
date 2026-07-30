type RateLimitClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options: { count: "exact"; head: true },
    ) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          gte: (
            column: string,
            value: string,
          ) => Promise<{ count: number | null; error: unknown }>;
        };
      };
    };
    insert: (
      value: { scope: string; key_hash: string },
    ) => Promise<{ error: unknown }>;
  };
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function rateLimit(
  sb: RateLimitClient,
  scope: string,
  key: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  try {
    const keyHash = await sha256Hex(key);
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const { count, error } = await sb
      .from("rate_limit_events")
      .select("*", { count: "exact", head: true })
      .eq("scope", scope)
      .eq("key_hash", keyHash)
      .gte("created_at", since);
    if (error || (count ?? 0) >= limit) return false;
    const inserted = await sb.from("rate_limit_events").insert({
      scope,
      key_hash: keyHash,
    });
    return !inserted.error;
  } catch {
    return false;
  }
}
