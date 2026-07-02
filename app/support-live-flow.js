(() => {
  const originalFetch = window.fetch.bind(window);

  const isSupportSubmit = input => {
    const url = typeof input === "string" ? input : input?.url || "";
    return url.includes("/functions/v1/support-submit-secure");
  };

  const makeDemoCase = () => {
    const now = new Date();
    const suffix = now.getTime().toString().slice(-6);
    const folio = "DEMO-SOP-" + suffix;
    const token = "demo-token-" + suffix;

    const title =
      document.querySelector("#spTitle")?.value?.trim() ||
      document.querySelector("[name='titulo']")?.value?.trim() ||
      "Caso demo de soporte";

    const desc =
      document.querySelector("#spDesc")?.value?.trim() ||
      document.querySelector("textarea")?.value?.trim() ||
      "Caso demo generado desde GitHub Pages.";

    const name =
      document.querySelector("#spName")?.value?.trim() ||
      "Cliente Demo";

    const email =
      document.querySelector("#spEmail")?.value?.trim() ||
      "cliente.demo@example.test";

    const company =
      document.querySelector("#spCompany")?.value?.trim() ||
      "Empresa Demo";

    const ticket = {
      id: "demo-support-" + suffix,
      folio,
      token,
      titulo: title,
      descripcion: desc,
      nombre_capturado: name,
      correo_capturado: email,
      empresa_capturada: company,
      estado: "abierto",
      prioridad: "media",
      tipo: "soporte",
      sistema: document.querySelector("#spSystem")?.value || "Ticket Core Demo",
      fecha_creacion: now.toISOString(),
      fecha_actualizacion: now.toISOString(),
      timeline_publica: [
        {
          kind: "evento",
          autor: "sistema",
          texto: "Caso demo recibido desde GitHub Pages.",
          fecha: now.toISOString()
        }
      ],
      adjuntos: [],
      read_only: false,
      is_test: true
    };

    try {
      localStorage.setItem("tc_demo_last_ticket", JSON.stringify(ticket));
      const arr = JSON.parse(localStorage.getItem("tc_demo_tickets") || "[]");
      arr.unshift(ticket);
      localStorage.setItem("tc_demo_tickets", JSON.stringify(arr.slice(0, 20)));
    } catch (_) {}

    const url = new URL("estado.html", location.href);
    url.searchParams.set("folio", folio);
    url.searchParams.set("token", token);
    url.searchParams.set("demo_case", ticket.id);

    return {
      ticket,
      response: {
        ok: true,
        demo: true,
        folio,
        token_publico: token,
        token,
        ticket_id: ticket.id,
        magic_link: url.toString()
      }
    };
  };

  window.fetch = async (input, init) => {
    if (!isSupportSubmit(input)) return originalFetch(input, init);

    try {
      const real = await originalFetch(input, init);
      if (real.ok) return real;

      console.warn("SUPPORT_REAL_FAILED_USING_DEMO_FALLBACK", real.status);
      const demo = makeDemoCase();
      return new Response(JSON.stringify(demo.response), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.warn("SUPPORT_REAL_THROW_USING_DEMO_FALLBACK", err);
      const demo = makeDemoCase();
      return new Response(JSON.stringify(demo.response), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  };

  const autoRedirect = () => {
    const box = document.querySelector("#spSuccessBox");
    const link = document.querySelector("#spOpenStatusLink");

    if (!box || !link) return;
    if (box.classList.contains("hidden")) return;
    if (!link.href || link.href.endsWith("#")) return;
    if (sessionStorage.getItem("tc_demo_redirecting") === link.href) return;

    sessionStorage.setItem("tc_demo_redirecting", link.href);

    const msg = document.querySelector("#spStatus") || document.querySelector("[data-status]");
    if (msg) msg.textContent = "Caso recibido. Abriendo seguimiento…";

    setTimeout(() => {
      location.href = link.href;
    }, 900);
  };

  window.addEventListener("DOMContentLoaded", () => {
    const obs = new MutationObserver(autoRedirect);
    obs.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true
    });
    setInterval(autoRedirect, 800);
  });
})();
