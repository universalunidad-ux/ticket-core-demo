# Contrato de indicadores de Tickets

Este contrato define una sola fuente de verdad para el número mostrado, el filtro aplicado y la lista resultante. Las comparaciones de estado pasan por `ticketStateKey`; prioridad se normaliza antes de comparar.

| Indicador | Predicado canónico | URL |
| --- | --- | --- |
| Urgentes | `prioridad = urgente` y estado distinto de `resuelto`/`cerrado` para el conteo. El enlace activa `prioridad = urgente`; las columnas ya excluyen `cerrado`. | `tickets.html?kpi=urgent` |
| En espera | `estado = esperando_cliente`. En móvil se muestra dentro de “En proceso”, sin perder el estado real. | `tickets.html?kpi=waiting` |
| Urgentes sin tocar | prioridad `urgente` o `alta`, estado distinto de `resuelto`/`cerrado`, y `fecha_actualizacion` (o `fecha_creacion`) estrictamente anterior al inicio del día local actual. | `tickets.html?kpi=urgent_stale` |
| Resueltos | `estado = resuelto`. | `tickets.html?kpi=resolved` |
| Respuesta vencida | caso activo sin primera respuesta y con la marca o plazo de primera respuesta vencido según la política SLA vigente. | `tickets.html?kpi=first_response_overdue` |
| SLA vencido | estado distinto de `resuelto`/`cerrado` y resolución marcada como vencida por el backend. | `tickets.html?kpi=sla_overdue` |

“Sin tocar” sin calificador queda deprecado por ambiguo. La interfaz debe decir “Urgentes sin tocar”. Un ticket con fecha futura no se considera sin tocar.

## Reglas de navegación y paridad

- El indicador es un enlace real y sigue funcionando aunque falle JavaScript.
- Con JavaScript, activar o desactivar el indicador actualiza `kpi` mediante History API sin recargar.
- Al abrir una URL directa, `applyUrlFilters` reconstruye el filtro y su estado seleccionado.
- El tablero y cualquier contador contextual deben aplicar el mismo predicado canónico; no se permiten cifras codificadas en HTML.
- El propio KPI comunica la selección con fondo activo, texto blanco y `aria-current`; no se crea una fila o pill redundante. “Limpiar filtros” elimina también `kpi`.
- Si otros filtros están activos, los indicadores se calculan sobre ese subconjunto. Sin filtros, se calculan sobre todos los tickets autorizados para la sesión.

## Propiedad y zona horaria

El backend conserva la autoridad sobre acceso, estado, primera respuesta y vencimientos SLA. El frontend sólo presenta y filtra las filas autorizadas. “Inicio del día” usa la zona horaria local del navegador; si el producto requiere cortes globales, el backend deberá exponer un campo booleano canónico.
