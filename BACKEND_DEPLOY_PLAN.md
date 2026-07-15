# Backend deploy plan

No ejecutar este plan directamente en producción. Requiere staging, revisión de seguridad y respaldo verificable.

## Orden de despliegue

1. Preparar staging con copia estructural, datos sintéticos y pruebas por rol.
2. Aplicar migraciones de `reglas_asignacion` y `site_config`.
3. Validar RLS, grants, auditoría y Data API con casos positivos y negativos.
4. Desplegar `support-submit-secure` con `empresa` opcional.
5. Validar contratos canónicos de respuestas, notas y adjuntos.
6. Activar notificaciones y asignación sólo después de idempotencia y observabilidad.
7. Ejecutar reconciliación de Storage en modo reporte; reparar objetos únicamente en una operación posterior aprobada.

## 1. support-submit-secure

- Cambio: aceptar `empresa` vacía también en Edge y conservar normalización de correo/teléfono.
- Precondición: fixtures con y sin empresa; versión actual respaldada.
- Positiva: crear solicitud válida con `empresa = null` y con empresa informada.
- Negativa: rechazar correo/teléfono inválidos sin crear filas parciales.
- Rollback: restaurar la versión Edge anterior; no revertir solicitudes válidas ya creadas.
- Staging: obligatorio.

## 2. reglas_asignacion

- Cambio: migración revisable para `eliminado_en`, `eliminado_por`, `actualizado_por` y contratos relacionados; índices para reglas activas.
- Precondición: inventario de columnas/policies y respaldo de reglas.
- Positiva: listar, crear, editar y retirar lógicamente una regla como admin.
- Negativa: Soporte no puede mutar reglas; una regla retirada no participa.
- Rollback: desactivar la UI/motor; evitar eliminar columnas con datos durante rollback inmediato.
- Staging: obligatorio.

## 3. site_config

- Cambio: tabla, claves únicas, RLS, grants mínimos y bitácora sin payload sensible.
- Precondición: revisar `docs/B20A_SITE_CONFIG_DRAFT.sql` contra el esquema vigente.
- Positiva: admin guarda texto plano y el público lee sólo claves publicables.
- Negativa: anon no escribe; HTML/script se rechaza o neutraliza.
- Rollback: desactivar capability y volver a defaults locales; conservar tabla para auditoría.
- Staging: obligatorio.

## 4. notificaciones

- Cambio: definir contrato real de movimientos/leídos o mantener estado `NOT_CONNECTED`.
- Precondición: dueño, retención, privacidad y clave de idempotencia definidos.
- Positiva: un movimiento produce una sola notificación autorizada.
- Negativa: otro usuario/token no puede leer movimientos ajenos.
- Rollback: ocultar contador y conservar timeline público como fuente informativa.
- Staging: obligatorio.

## 5. archivos y Storage

- Cambio: regenerar signed URLs desde `storage_path`, inventariar objetos huérfanos y validar policies de `soporte_adjuntos`.
- Precondición: reporte de `archivos_ticket`, `ticket_archivos` y `storage.objects`; nunca persistir signed URLs nuevas.
- Positiva: imagen válida, expirada y no visual abren con URL temporal renovada.
- Negativa: ruta ajena/objeto ausente devuelve error controlado sin filtrar información.
- Rollback: desactivar transformaciones y servir URL firmada original; mantener placeholder frontend.
- Staging: obligatorio. La reparación de datos requiere aprobación separada.

## 6. respuestas, notas y adjuntos

- Cambio: operación canónica y atómica para evento + adjuntos + auditoría.
- Precondición: definir tabla/evento canónico y estrategia de compatibilidad legacy.
- Positiva: respuesta, nota interna y cierre generan exactamente un evento.
- Negativa: fallo de Storage revierte metadatos; doble clic conserva una sola idempotency key.
- Rollback: volver al endpoint anterior y reconciliar sólo mediante reporte.
- Staging: obligatorio.

## 7. asignación

- Cambio: transacción con auditoría, versión esperada e idempotencia; el motor permanece `NOT_CONNECTED` hasta aprobarse.
- Precondición: reglas migradas y matriz de prioridades/solapes validada.
- Positiva: una regla asigna una vez y registra actor/motivo.
- Negativa: carreras y reintentos no reasignan ni duplican bitácora.
- Rollback: feature flag del motor en off; conservar asignaciones ya auditadas.
- Staging: obligatorio.

## 8. Auth y RLS

- Cambio: matriz positiva/negativa para Admin, Soporte y público; revisar Storage y vistas `security_invoker`.
- Precondición: cuentas sintéticas por rol y tokens de corta duración.
- Positiva: cada rol accede únicamente a su alcance documentado.
- Negativa: acceso cruzado por UUID, REST directo o signed path ajeno falla.
- Rollback: retirar grants/policies nuevas y desactivar features dependientes.
- Staging: obligatorio antes de cualquier producción.
