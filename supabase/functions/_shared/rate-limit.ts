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
      value: { scope: string; key: string },
    ) => Promise<{ error: unknown }>;
  };
};

export async function rateLimit(
  sb: RateLimitClient,
  scope: string,
  key: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const { count, error } = await sb
      .from("rate_limit_events")
      .select("*", { count: "exact", head: true })
      .eq("scope", scope)
      .eq("key", key)
      .gte("created_at", since);
    if (error || (count ?? 0) >= limit) return false;
    const inserted = await sb.from("rate_limit_events").insert({ scope, key });
    return !inserted.error;
  } catch {
    return false;
  }
}
