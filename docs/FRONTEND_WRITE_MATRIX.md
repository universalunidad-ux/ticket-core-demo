# Matriz de escrituras del frontend (app/**) → autorización requerida

Escaneo de `insert/update/delete/upsert/rpc/storage` en `app/**` y la policy/grant que
las habilita. "Interno" = perfil admin/supervisor/soporte/ventas (is_internal_user()).
Las escrituras de configuración (dashboard) son **solo admin**. Nada anónimo.

| ARCHIVO | OPERACIÓN | TABLA/BUCKET | ROL NECESARIO | POLICY | GRANT |
|---|---|---|---|---|---|
| supabase.js, ticket.js, dashboard.js | insert | bitacora | interno (usuario_id=self) | bitacora_insert_self | insert authenticated |
| ticket.js, tickets.js | insert | ticket_eventos | staff con acceso al ticket | ticket_eventos_staff_insert | insert authenticated |
| ticket.js | insert/delete | archivos_ticket | staff con acceso al ticket | archivos_ticket_staff_write | insert,delete authenticated |
| ticket.js | insert/delete | ticket_archivos | staff con acceso al ticket | ticket_archivos_staff_write | insert,delete authenticated |
| ticket.js | insert/update/delete | cliente_sistemas | interno | cliente_sistemas_staff_write | insert,update,delete authenticated |
| ticket.js | insert/update | cliente_accesos | interno | cliente_accesos_staff_write | insert,update authenticated |
| ticket.js | update | perfiles (tema/prefs propios) | dueño | perfiles_update_self (V1) | update authenticated |
| ticket.js | update | tickets (ticket asignado) | admin o soporte asignado | tickets_admin_update (V1) | update authenticated |
| tickets.js, ticket-assignment.js, tickets-assignment.js | update | tickets (asignado_a) | admin/supervisor | tickets_manager_assign | update authenticated |
| ticket.js, quick-replies.shared.js | insert/update/delete | ticket_respuestas_rapidas | admin | quick_replies_admin_write | insert,update,delete authenticated |
| dashboard.js | insert/update | reglas_asignacion | admin | reglas_asignacion_admin_write | insert,update authenticated |
| dashboard.js | insert/update/delete | avisos_globales | admin | avisos_globales_admin_write | insert,update,delete authenticated |
| dashboard.js | upsert | site_config | admin | site_config_admin_write (V1) | insert,update authenticated |
| ticket.js, dashboard.js | createSignedUrl | storage soporte_adjuntos | staff con acceso al ticket | soporte_adjuntos_staff_read (U5) | — |
| ticket.js | upload/remove | storage soporte_adjuntos | staff con acceso al ticket | soporte_adjuntos_staff_write | — |
| supabase.js | createSignedUrl | storage certificados | interno | certificados_staff_read (U5) | — |

Notas:
- El flujo público (soporte-submit, estado) NO usa Data API anónimo: va por Edge (service_role).
- `bitacora` lectura sigue restringida a admin (V1); aquí solo se habilita INSERT propio.
- Escrituras de config (reglas_asignacion, avisos_globales, site_config, quick replies)
  coinciden con el gating de UI (admin) y se imponen por RLS, no por el navegador.
