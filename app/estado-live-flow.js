(() => {
  const originalFetch = window.fetch.bind(window);
  const qs = new URLSearchParams(location.search);
  const isDemoCase = qs.has("demo_case") || String(qs.get("token") || "").startsWith("demo-token-");

  const getDemoTicket = () => {
    try {
      const id = qs.get("demo_case");
      const last = JSON.parse(localStorage.getItem("tc_demo_last_ticket") || "null");
      const arr = JSON.parse(localStorage.getItem("tc_demo_tickets") || "[]");
      return arr.find(t => t.id === id) || last;
    } catch (_) {
      return null;
    }
  };

  const fallbackTicket = () => {
    const now = new Date().toISOString();
    const folio = qs.get("folio") || "DEMO-SOP-000000";
    return {
      id: qs.get("demo_case") || "demo-status",
      folio,
      titulo: "Caso demo de soporte",
      descripcion: "Seguimiento demo generado en GitHub Pages.",
      empresa_capturada: "Empresa Demo",
      nombre_capturado: "Cliente Demo",
      correo_capturado: "cliente.demo@example.test",
      estado: "abierto",
      prioridad: "media",
      tipo: "soporte",
      sistema: "Ticket Core Demo",
      fecha_creacion: now,
      fecha_actualizacion: now,
      timeline_publica: [
        {
          kind: "evento",
          autor: "sistema",
          texto: "Caso demo recibido correctamente.",
          fecha: now
        }
      ],
      adjuntos: [],
      read_only: false,
      is_test: true
    };
  };

  const isEstadoLoad = input => {
    const url = typeof input === "string" ? input : input?.url || "";
    return url.includes("/functions/v1/estado-ticket-ts");
  };

  const isEstadoReply = input => {
    const url = typeof input === "string" ? input : input?.url || "";
    return url.includes("/functions/v1/estado-ticket-responder-ts");
  };

  window.fetch = async (input, init) => {
    if (!isDemoCase) return originalFetch(input, init);

    if (isEstadoLoad(input)) {
      try {
        const real = await originalFetch(input, init);
        if (real.ok) return real;
      } catch (_) {}

      const ticket = getDemoTicket() || fallbackTicket();
      return new Response(JSON.stringify({ ticket }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (isEstadoReply(input)) {
      try {
        const real = await originalFetch(input, init);
        if (real.ok) return real;
      } catch (_) {}

      const ticket = getDemoTicket() || fallbackTicket();
      const now = new Date().toISOString();
      ticket.timeline_publica = Array.isArray(ticket.timeline_publica) ? ticket.timeline_publica : [];
      ticket.timeline_publica.push({
        kind: "mensaje",
        autor: "cliente",
        texto: "Respuesta demo recibida desde GitHub Pages.",
        fecha: now
      });
      ticket.fecha_actualizacion = now;

      try {
        localStorage.setItem("tc_demo_last_ticket", JSON.stringify(ticket));
      } catch (_) {}

      return new Response(JSON.stringify({ ok: true, ticket }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return originalFetch(input, init);
  };

  window.addEventListener("DOMContentLoaded", () => {
    if (!isDemoCase) return;
    const badge = document.createElement("div");
    badge.textContent = "Flujo demo · fallback local";
    badge.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;font:12px/1 system-ui;background:#0a1018cc;color:#fff;padding:6px 10px;border-radius:8px;opacity:.84;box-shadow:0 4px 18px rgba(0,0,0,.25)";
    document.body.appendChild(badge);
  });
})();
