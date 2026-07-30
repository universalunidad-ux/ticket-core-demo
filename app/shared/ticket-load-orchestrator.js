export const isRecoverableTicketTimeout = error =>
  /tickets rest fast timeout/i.test(String(error?.message || error || ""));

export async function resolveTicketLoad({
  request,
  withTimeout,
  fastMs = 4500,
  recoveryMs = 9000,
  isLatest = () => true,
  onRecovering = () => {},
  onTechnicalError = () => {},
} = {}) {
  let logged = false;
  const logOnce = error => {
    if (logged) return;
    logged = true;
    onTechnicalError(error);
  };
  const pending = Promise.resolve().then(request);
  try {
    return { rows: await withTimeout(pending, fastMs, "tickets rest fast"), source: "rest-fast", recovered: false };
  } catch (error) {
    if (!isRecoverableTicketTimeout(error)) {
      logOnce(error);
      throw error;
    }
    if (!isLatest()) throw Object.assign(new Error("stale ticket load"), { name: "AbortError" });
    onRecovering(error);
    try {
      const rows = await withTimeout(pending, recoveryMs, "tickets rest recovery");
      if (!isLatest()) throw Object.assign(new Error("stale ticket load"), { name: "AbortError" });
      return { rows, source: "rest-late-recovery", recovered: true };
    } catch (finalError) {
      logOnce(finalError);
      throw finalError;
    }
  }
}

export const waitingTicketRows = rows => (Array.isArray(rows) ? rows : [])
  .filter(ticket => String(ticket?.estado || "").trim().toLowerCase().replace(/[\s-]+/g, "_") === "esperando_cliente");
