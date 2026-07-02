# Ticket Core Demo — Estado de cierre

## Objetivo

Este repositorio público (`ticket-core-demo`) sirve una versión navegable de Ticket Core en GitHub Pages.

URL principal:

https://universalunidad-ux.github.io/ticket-core-demo/

Repositorio fuente privado:

`universalunidad-ux/TICKET-CORE`

## Estado actual

- `TICKET-CORE` queda como fuente privada/local.
- `ticket-core-demo` queda como demo pública en GitHub Pages.
- `panel-expiriti` queda como versión pública/paralela anterior.
- La demo pública contiene pantallas reales sincronizadas desde Ticket Core local.
- Se creó `supabase.config.public.js` para que Pages pueda usar configuración pública de frontend.
- No se publica `supabase.config.local.js`.
- No se publican claves de servidor.
- No se publica `.env`.

## Hecho

- GitHub Pages activado.
- `tickets.html`, `tickets.css`, `tickets.js` publicados.
- `ticket.html` publicado.
- `dashboard.html`, `soporte.html`, `estado.html`, `index.html` publicados.
- `aviso-privacidad.html` y `terminos.html` publicados.
- Assets raíz publicados.
- Carpeta `IMG/` sincronizada.
- Fallback de soporte/estado agregado para evitar flujo muerto en Pages.

## Pendiente conocido

### Janome

Faltan módulos/assets de Janome usados por algunas pantallas:

- `app/janome/janome_catalogo.js`
- `app/janome/janome_ticket.js`

Mientras falten, el navegador puede mostrar 404 para esos módulos.

También queda pendiente revisar si se debe publicar:

- `app/janome/janome_enriquecido.json`

Antes de publicarlo, confirmar que no contiene datos sensibles o privados.

### Supabase / Edge Functions

El flujo real depende de Supabase y Edge Functions. Pendiente revisar:

- `support-submit-secure`
- `match-cliente`
- `estado-ticket-ts`
- `estado-ticket-responder-ts`
- CORS/origin desde `https://universalunidad-ux.github.io`
- tabla o endpoint `site_config`, que actualmente puede devolver 404 si no existe

### Decisión técnica pendiente

Definir si `ticket-core-demo` será:

1. demo pública ficticia/segura, o
2. demo live con Supabase real.

Actualmente está en modo híbrido: usa pantallas reales y configuración pública, pero conserva fallback demo para que el flujo no se quede muerto si el backend falla.

## Reglas operativas

- No usar `git add .`.
- No publicar `.env`.
- No publicar `supabase.config.local.js`.
- No publicar claves de servidor.
- No publicar backups `.bak_*`.
- No publicar dumps SQL ni migraciones internas.
- No borrar `TICKET-CORE`.
- `TICKET-CORE` debe seguir privado.
