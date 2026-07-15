# Contratos remotos pendientes

Este candidato no modifica Supabase, Edge Functions, Storage ni esquemas remotos.

## Consentimiento del formulario público

El frontend exige consentimiento antes de enviar y conserva los datos del formulario si falta. Para auditoría persistente, el backend deberá aceptar y registrar, cuando se apruebe el contrato:

- `consentimiento_terminos_en timestamptz`
- `consentimiento_version text`
- `consentimiento_origen text`

El candidato no envía campos todavía no aceptados por la función remota.

## Video en seguimiento público

La interfaz valida un video MP4, WebM o MOV, de hasta 90 segundos y 20 MB. El envío se bloquea con un mensaje controlado porque la función de respuesta y su política de Storage todavía no declaran ese contrato. Se requiere actualizar y probar MIME, tamaño, duración, bucket/política y errores antes de habilitar la carga real.

## Atención en navegación global

El frontend admite una señal local sin datos personales (`section`, `reason`, `eventId`, tiempos). Para actividad pendiente real y consistente entre dispositivos se requiere una fuente autorizada del backend con estado leído/no leído por usuario. No se fabrican conteos ni alertas.

## Icono de envío público

El recurso solicitado `send.webp` no existe en el candidato, checkpoints ni inventario disponible. Se mantiene el botón de texto accesible para evitar una referencia rota o un duplicado inventado.
