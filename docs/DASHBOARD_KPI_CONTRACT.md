# Contrato de KPI del Dashboard

Fuente de verdad del rail de indicadores de `app/dashboard.html`. Owner único del render: `renderRail()` en `app/dashboard.js` (`loadMetrics()` construye los conteos). Ninguna cifra se codifica en HTML: todo conteo proviene de Supabase con `count: "exact", head: true` sobre la tabla `tickets`, salvo lo indicado. Caché: `sessionStorage` (`tc_dash_metrics`, TTL 60 s, por rol).

Convenciones: `OPEN_STATES = (abierto, en_proceso, esperando_cliente)`. "Hoy" e "inicio de semana (lunes)" se calculan con la zona horaria local del navegador. Un conteo fallido se muestra como `—` con `title` explicativo; nunca se inventa un número.

## Campos comunes a los 11 KPI del rail admin

- Fuente de datos: tabla `tickets` vía PostgREST (`select id`, `count: "exact"`, `head: true`), bajo las políticas RLS de la sesión. No existe vista ni materialización dedicada al Dashboard: NEEDS_CONTRACT para una fuente canónica compartida con `tickets.html` (hoy cada superficie construye su propio predicado).
- Autoridad: el backend (RLS y columnas de `tickets`) manda sobre acceso, estados, prioridades y vencimientos SLA; el frontend solo construye el predicado, cuenta y presenta. Ninguna cifra se calcula ni se persiste en el cliente más allá del caché de sesión declarado.
- Exclusiones: cada predicado enumera lo incluido; todo lo no listado queda excluido. En particular, `cerrado` nunca cuenta en KPI de estado abierto, urgencia ni SLA. "Creados hoy" y "Creados esta semana" no excluyen ningún estado (cuentan también resueltos y cerrados creados en el periodo).
- Relación cifra–lista: el enlace de un KPI debe aterrizar en una lista cuyo filtro reproduzca el predicado del conteo (paridad). Donde hoy eso no es posible, el KPI no enlaza y la brecha queda marcada abajo; nunca se enlaza a una lista que muestre otro subconjunto sin documentarlo.
- Zona horaria: todos los cortes temporales usan la zona local del navegador (misma regla que TICKET_KPI_CONTRACT: si el producto exige cortes globales, el backend debe exponer un campo canónico).

## Rail admin (11 KPI, orden fijo `ADMIN_RAIL`)

| KPI | Predicado canónico (Supabase) | Exclusiones | URL / navegación | Paridad cifra–lista | Estado del contrato |
| --- | --- | --- | --- | --- | --- |
| Abiertos | `estado = abierto` | resto de estados | `tickets.html?state=abierto` | plena: la lista aplica `FILTER.state=abierto` | VERIFICADO: columna `estado` y filtro `state` soportado por `applyUrlFilters` en `tickets.js`. |
| En proceso | `estado = en_proceso` | resto de estados | `tickets.html?state=en_proceso` | plena | VERIFICADO. |
| Esperando cliente | `estado = esperando_cliente` | resto de estados | `tickets.html?state=esperando_cliente` | plena | VERIFICADO. |
| Resueltos | `estado = resuelto` | resto de estados (incl. `cerrado`) | `tickets.html?state=resuelto` | plena | VERIFICADO. |
| Sin asignar | `asignado_a IS NULL AND estado IN OPEN_STATES` | asignados; `resuelto`/`cerrado` | sin enlace | n/a (sin lista destino) | VERIFICADO el predicado; NEEDS_CONTRACT el destino: `tickets.html` no expone filtro URL "sin asignar", por eso el KPI no enlaza. |
| Alta / Urgente | `prioridad IN (alta, urgente) AND estado IN OPEN_STATES` | prioridades media/baja; `resuelto`/`cerrado` | `tickets.html?priority=urgente` | PARCIAL: la lista muestra solo `urgente` | DISCREPANCIA DOCUMENTADA: el conteo incluye `alta`, pero el enlace filtra solo `urgente` (la URL no admite multiprioridad). NEEDS_CONTRACT para un filtro `priority=alta,urgente` o `kpi=` dedicado. |
| Creados hoy | `fecha_creacion >= inicio del día local` | ninguna por estado | sin enlace | n/a | VERIFICADO; corte por zona horaria del navegador. |
| Creados esta semana | `fecha_creacion >= lunes local 00:00` | ninguna por estado | sin enlace | n/a | VERIFICADO; misma nota de zona horaria. |
| Por consolidar | `requiere_consolidacion = true AND estado != cerrado` | `cerrado` | `consolidacion-clientes.html` | la página destino aplica su propia consulta de consolidación | VERIFICADO en frontend (columna consumida también por `consolidacion-clientes.js`); NEEDS_CONTRACT: no hay definición backend en el repo de cuándo se activa `requiere_consolidacion`. |
| SLA 1ª respuesta vencido (etiqueta visible: «SLA 1ª vencida») | `sla_first_response_deadline < now() AND estado = abierto` | `en_proceso`, `esperando_cliente`, `resuelto`, `cerrado`; no comprueba `primera_respuesta_en` | sin enlace | n/a (ver estado) | NEEDS_CONTRACT: (1) no existe en el repo definición backend de `sla_first_response_deadline`; (2) el predicado difiere de TICKET_KPI_CONTRACT ("caso activo sin primera respuesta"): aquí no se comprueba `primera_respuesta_en` y solo cuenta `abierto`. Existe `tickets.html?kpi=first_response_overdue` pero usa otro predicado (`sla_breached_first_response`), por eso el KPI no enlaza hasta unificar. |
| SLA resolución vencido (etiqueta visible: «SLA vencido») | `sla_resolution_deadline < now() AND estado IN OPEN_STATES` | `resuelto`, `cerrado` | sin enlace | n/a (ver estado) | NEEDS_CONTRACT: sin definición backend de `sla_resolution_deadline` en el repo; `tickets.html?kpi=sla_overdue` filtra por `sla_breached_resolution` (predicado distinto), por eso el KPI no enlaza hasta unificar. |

## Rail soporte (`SOPORTE_RAIL`, mismas reglas)

Todos con `asignado_a = <perfil de la sesión>`: Mis tickets abiertos (`estado IN OPEN_STATES`, → `tickets.html`); Esperando cliente (`estado = esperando_cliente`); Alta/urgente (`prioridad IN (alta, urgente) AND estado IN OPEN_STATES`, enlace con la misma discrepancia `priority=urgente` que el rail admin); Próximos a vencer (`sla_resolution_deadline < now()+24 h AND estado IN OPEN_STATES`, sin enlace, NEEDS_CONTRACT por la columna SLA); Cerrables (`estado = resuelto`, → `tickets.html?state=resuelto`); Por consolidar (global, igual que admin).

## Bloques auxiliares del rail

- `#kpiRailNotes` (fuera del scroller): "Carga por agente" proviene de la vista `v_janome_dashboard_agentes`, probada una vez por sesión (`tc_cap_dashviews`); si no está desplegada se muestra "Métricas complementarias pendientes". NEEDS_CONTRACT: la vista no tiene definición en el repo.
- "Mis Tickets" (`#dashMiKpis`) reutiliza los conteos `mis*` de esta misma carga; no ejecuta consultas adicionales.
- Resumen de agentes: vista `v_tickets_agente_resumen`. NEEDS_CONTRACT: sin definición en el repo; el frontend tolera su ausencia.

## Reglas de presentación (B21)

El rail es una sola fila sin wrap con scroll horizontal propio (nunca overflow global), `scroll-snap-type: x proximity`, flechas prev/next ocultas sin overflow y deshabilitadas en los extremos, swipe/trackpad nativos y teclado (←/→/Home/End con el rail enfocado). Tarjetas de ancho `clamp(116px, 11vw, 148px)`, altura uniforme (`min-height: 72px`) y etiqueta limitada a dos líneas (`-webkit-line-clamp: 2`; los saltos deliberados usan `<br>` en `KPI_DEF`). Los KPI con enlace se renderizan como `<a>` reales que funcionan sin JavaScript una vez pintados; los tonos warn/bad solo colorean, nunca sustituyen el valor. Tonos vigentes: warn si valor > 0 en Sin asignar, Alta/Urgente y Por consolidar; bad si valor > 0 en ambos KPI de SLA; el resto es neutro.
