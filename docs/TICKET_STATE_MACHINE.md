# Máquina de estados de Tickets

## Estados canónicos

| Estado | Texto público | Compositor público | Salidas permitidas |
| --- | --- | --- | --- |
| `abierto` | Recibido | Disponible | `en_proceso` |
| `en_proceso` | En revisión | Disponible | `abierto`, `esperando_cliente`, `resuelto` |
| `esperando_cliente` | Esperando tu respuesta | Disponible, con solicitud de información | `en_proceso`, `resuelto` |
| `resuelto` | Resuelto | Disponible para confirmar o reportar que continúa | `en_proceso`, `cerrado` |
| `cerrado` | Cerrado | Bloqueado; sólo consulta | Ninguna transición pública |

Los alias históricos se normalizan antes de decidir el estado. `cerrado` es terminal para el enlace público; una reapertura administrativa futura exige una transición explícita y auditada.

## Eventos y transiciones

1. Crear ticket produce un solo evento de sistema “Solicitud recibida”. La UI deduplica el evento persistido y el sintético por semántica, no sólo por identificador.
2. La primera acción del agente puede mover `abierto → en_proceso` y registrar primera respuesta.
3. Solicitar información mueve `en_proceso → esperando_cliente` y genera una notificación fuerte al cliente.
4. Una respuesta válida del cliente crea un evento público con autor `cliente` y debe mover `esperando_cliente → en_proceso` de forma atómica en backend.
5. Resolver mueve el caso activo a `resuelto` y registra autor, fecha y motivo.
6. “Sigue pendiente” o una respuesta posterior del cliente solicita `resuelto → en_proceso` y registra la reapertura.
7. Confirmar solución permite `resuelto → cerrado`; al cerrar, el compositor queda bloqueado.

## Último actor y mensajes públicos

El texto de estado depende del estado canónico y del último actor relevante (`cliente`, `soporte`, `sistema`). El frontend no debe inferir autor a partir del color o posición visual. El backend debe emitir autor, fecha, tipo de evento e identificador estable.

## Notificaciones

- `esperando_cliente` y `resuelto` son cambios fuertes; otros mensajes, archivos o estados son cambios suaves.
- La firma de deduplicación incluye estado, última actualización y cantidad/identidad de eventos y adjuntos.
- Sonido es opt-in, respeta silencio/volumen y nunca se reproduce en la primera carga.
- El polling se detiene cuando la pestaña no está visible o el ticket está cerrado/read-only.

## Autoridad y atomicidad requeridas

RLS y las funciones remotas son la autoridad. Cada transición debe validar estado origen, rol, propiedad/asignación, límite de respuestas y token público, y escribir cambio de estado + evento en una sola transacción idempotente. Este documento no despliega ni modifica backend.
