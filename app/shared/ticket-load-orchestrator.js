export const isRecoverableTicketTimeout = error =>
  /tickets rest (?:fast|recovery) timeout/i.test(String(error?.message || error || ""));

const AUTH_ERROR = /JWT expired|PGRST303|Invalid Refresh Token|Refresh Token|Sesión no activa|session_not_found|Unauthorized|\b401\b|\b403\b/i;

export const isRecoverableTicketLoadError = error => {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403 || AUTH_ERROR.test(message)) return false;
  if (status >= 500 && status <= 599) return true;
  if (/Tickets HTTP 5\d\d\b/i.test(message)) return true;
  if (isRecoverableTicketTimeout(error)) return true;
  return error instanceof TypeError || /network|failed to fetch|fetch failed|load failed|connection|conexi[oó]n/i.test(message);
};

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
  const runAttempt = () => Promise.resolve().then(request);
  try {
    return { rows: await withTimeout(runAttempt(), fastMs, "tickets rest fast"), source: "rest-fast", recovered: false };
  } catch (error) {
    if (!isRecoverableTicketLoadError(error)) {
      logOnce(error);
      throw error;
    }
    if (!isLatest()) throw Object.assign(new Error("stale ticket load"), { name: "AbortError" });
    onRecovering(error);
    try {
      const rows = await withTimeout(runAttempt(), recoveryMs, "tickets rest recovery");
      if (!isLatest()) throw Object.assign(new Error("stale ticket load"), { name: "AbortError" });
      return { rows, source: "rest-fresh-recovery", recovered: true };
    } catch (finalError) {
      logOnce(finalError);
      throw finalError;
    }
  }
}

export const waitingTicketRows = rows => (Array.isArray(rows) ? rows : [])
  .filter(ticket => String(ticket?.estado || "").trim().toLowerCase().replace(/[\s-]+/g, "_") === "esperando_cliente");
