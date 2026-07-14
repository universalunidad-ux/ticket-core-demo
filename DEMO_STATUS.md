# Ticket Core Demo — revisión interna live

Este repositorio sirve una instancia live de revisión interna de Ticket Core mediante GitHub Pages bajo `/ticket-core-demo/`.

## Alcance

- La interfaz se sincroniza desde una revisión local aprobada.
- `supabase.config.public.js` contiene únicamente la URL pública del proyecto y su publishable key.
- No se publica configuración local, claves de servidor, variables de entorno, instaladores, dumps ni datos reales.
- El login, la sesión persistente, las pantallas internas, Storage y las Edge Functions conservan la integración real con Supabase.
- La ruta opcional `tickets.html?readonly=1` sigue disponible como vista sintética de 45 tickets, pero no sustituye los flujos live autenticados.
- Los formularios públicos y el acceso autenticado dependen de los permisos efectivos del backend.

## Estado de seguridad

`BACKEND_HARDENING_STATUS` permanece `PENDING`: la evidencia local no certifica el conjunto desplegado de RLS, grants, vistas, Storage, redirects de Auth y funciones remotas. Esta observación no desactiva la integración live solicitada, pero impide declarar el entorno apto para producción.

Las pruebas deben usar exclusivamente cuentas y registros sintéticos autorizados. No publiques secretos, capturas con información personal ni credenciales en issues.

## Janome

Se incluye el catálogo JavaScript requerido por el selector de productos. El archivo enriquecido no existe en la revisión aprobada y no se sustituye ni solicita, por lo que no genera un 404. El generador Node de catálogo se excluye por no ser código de navegador.
