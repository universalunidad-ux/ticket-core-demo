# Contrato del workspace de Clientes

`CLIENT_RLS_BLOCKED=YES`

## Alcance activo

- `clientes` se consulta únicamente con la sesión autenticada y conserva el alcance impuesto por RLS.
- `tickets` se consulta con el mismo alcance; para soporte el frontend añade `asignado_a = auth.uid()`.
- El filtro de agente, incluido “Sin agente”, se habilita sólo para `admin`.
- Búsqueda, orden, conteo y paginación se calculan sobre todas las filas autorizadas recuperadas en lotes; nunca sobre una sola página parcial.

## Contratos bloqueados

- `clientes_contactos`: no se consume en el listado hasta que exista un contrato integral de `SELECT`/`INSERT`, ownership y RLS probado con cuentas sintéticas.
- `cliente_sistemas`: no se consume en el listado ni se escribe desde el frontend hasta cerrar grants, owners y RLS por cliente.
- `supervisor`: no recibe el filtro administrativo hasta que rol, visibilidad de tickets y políticas relacionadas se validen de extremo a extremo.
- Alta y consolidación no harán escrituras multitabla desde el navegador. Requieren un endpoint transaccional, autorizado, idempotente y auditable.

El borrador `CLIENT_ROLE_FILTER_RLS_DRAFT.sql` continúa siendo documentación no desplegable. Esta unidad no ejecuta SQL remoto ni cambia políticas.

## Auditoría local de Alta (2026-07-16)

- Tablas/columnas observadas por consumidores existentes: `clientes(id,nombre,ultima_interaccion,origen_registro)`, `clientes_contactos(id,cliente_id,nombre,puesto,correo,telefono,es_principal,activo)` y `cliente_sistemas` con modelo/sistema y serie según lectores legacy.
- RLS/grants: el borrador local declara contactos deny-all en el estado vigente y sistemas con lectura interna demasiado amplia; ambos siguen pendientes de contrato integral y pruebas sintéticas. No se ejecutó el borrador.
- Owners de base: el repositorio no contiene un snapshot confiable de `tableowner`/`proowner`; no se declaran como auditados y deberán verificarse en staging antes de habilitar el contrato.
- Owners: la única escritura admitida por la UI es `crear-cliente-janome`; debe ser owner transaccional de cliente + contacto principal + sistema + auditoría, validar rol admin, duplicados e idempotencia. El frontend no hace inserts multitabla.
- RFC: no existe columna ni clave de payload confirmada localmente; se omite.
- WhatsApp: existe en tickets públicos, pero no hay campo confirmado en `clientes_contactos` ni en el payload de alta; se muestra como pendiente y no se guarda en notas.
- Listeners: un único listener de `submit`, uno de limpieza, validación `input/blur` por campo y un debounce de 450 ms para nombre. `busy` bloquea reentrada y la misma `idempotency_key` aleatoria se conserva durante reintentos del mismo formulario.
- Duplicados: el precheck frontend consulta sólo nombres de `clientes` autorizados. Correo y teléfono deben comprobarse dentro de la transacción, donde existe acceso seguro; una respuesta `409` nunca se convierte en éxito.
