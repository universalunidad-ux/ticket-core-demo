# Ticket Core Demo — estado controlado

Este repositorio sirve una demostración navegable de Ticket Core mediante GitHub Pages bajo `/ticket-core-demo/`.

## Alcance

- La interfaz se sincroniza desde una revisión local aprobada.
- `supabase.config.public.js` contiene únicamente la URL pública del proyecto y su publishable key.
- No se publica configuración local, claves de servidor, variables de entorno, instaladores, dumps ni datos reales.
- La ruta `tickets.html?readonly=1` usa sólo datos sintéticos en memoria y no consulta ni modifica Supabase.
- Los formularios públicos y el acceso autenticado conservan el cliente Supabase; su autorización efectiva depende del backend.

## Estado de seguridad

La evidencia local no basta para certificar el conjunto desplegado de RLS, grants, vistas, Storage, redirects de Auth y funciones remotas. Por ello, `PUBLIC_BACKEND_GATE` permanece `BLOCKED_INSUFFICIENT_EVIDENCE` hasta una revisión remota separada y autorizada.

No uses datos reales para probar la demo. No publiques secretos, capturas con información personal ni credenciales en issues.

## Janome

Se incluye el catálogo JavaScript requerido por el selector de productos. El archivo enriquecido no existe en la revisión aprobada y no se sustituye ni solicita, por lo que no genera un 404. El generador Node de catálogo se excluye por no ser código de navegador.
