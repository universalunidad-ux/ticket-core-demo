# TC-P0 — Empresa opcional en solicitudes públicas

Estado: implementación local preparada; no desplegada.

## Procedencia

- Proyecto: `ovfmqqqwezfdtgrtkjhf`.
- Edge Function: `support-submit-secure`.
- Fuente recuperada mediante lectura administrativa: versión 57, activa, `verify_jwt=false`.
- SHA-256 del bundle remoto informado: `9c51469401d3c6cd6bac45296b0efb20c1d317bfb582ebcb3a7421b821ea1be5`.
- SHA-256 de los 23,426 bytes del `index.ts` recuperado: `ca6d03a4827644c1d8df53fb2c68d99b670fb69115a7b71d6a08369dd8dae9df`.
- Snapshot sin modificaciones, codificado en Base64: `supabase/functions/support-submit-secure/upstream-v57/index.ts.b64`.

El gate decodifica el snapshot y verifica su hash byte por byte. El archivo operativo parte de ese original; el cambio acepta Empresa ausente, conserva obligatorios Nombre/Título/Descripción/Sistema/Correo/Teléfono y evita ejecutar matching textual con `null`.

## Contrato frontend / Edge / base de datos

- El HTML presenta Empresa como “Opcional” y no usa `required`.
- El frontend serializa `empresa: trimVal("spCompany") || null`.
- La Edge normaliza Empresa a `string | null`, ya no la incluye entre los campos obligatorios y persiste `empresa || null`.
- La base actual fue auditada con `solicitudes_soporte.empresa NOT NULL`. El borrador SQL elimina solo esa restricción; no crea valores falsos ni toca RLS.

## Pruebas locales

`node tools/support-company-contract-test.mjs` cubre:

1. solicitud con Empresa;
2. solicitud sin Empresa, serializada como `null`;
3. control negativo sin otro campo realmente obligatorio;
4. paridad estática con el archivo Edge versionado.

No se envía ninguna solicitud real y no se escriben datos remotos.

## Bloqueos posteriores fuera de este P0

### Bucket y adjuntos

El inventario remoto previo encontró únicamente el bucket privado `ticket-public`; v57 escribe en `soporte_adjuntos`. Hasta crear y validar ese bucket con límites y políticas coherentes, el flujo de archivos puede fallar aunque la solicitud sin adjuntos funcione. Este P0 no crea buckets ni relaja políticas.

El frontend admite HEIC/HEIF y video de hasta 40 MB; v57 solo admite JPG/JPEG/PNG/WebP/PDF/XML/XLS/XLSX/CSV/TXT/ZIP y limita cada archivo a 20 MB. La paridad de tipos y tamaños queda pendiente.

### Atomicidad

v57 crea solicitud, ticket, eventos y metadatos mediante escrituras secuenciales antes y durante la subida. No existe una RPC transaccional que confirme todo o nada. Un fallo intermedio puede dejar solicitud, ticket, metadatos u objetos parciales. Este P0 no reestructura el flujo.

### Idempotencia

v57 no reclama una clave de idempotencia antes de crear folio/solicitud/ticket. Reintentos, doble clic o timeouts pueden duplicar casos. La solución requiere contrato de idempotencia autoritativo y limpieza/compensación verificable; queda para una unidad backend separada.

### Orden de despliegue futuro

1. revisar y aplicar el cambio nullable en una ventana controlada;
2. verificar `is_nullable = YES`;
3. desplegar la Edge parcheada como versión nueva;
4. probar con y sin Empresa, primero sin adjuntos;
5. resolver bucket/adjuntos, atomicidad e idempotencia en unidades separadas.

Nada de lo anterior fue ejecutado desde este worktree.
