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
