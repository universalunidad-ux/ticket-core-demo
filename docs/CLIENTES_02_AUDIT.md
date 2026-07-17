# Auditoría estática — CLIENTES-02

Fecha: 2026-07-17

## Catálogo y filtro de equipos

- Fuente única: `app/janome/janome_catalogo.js`.
- Sólo se aceptan grupos cuyo nombre real comienza con `Máquinas — `. Los grupos `Accesorios — …` y la opción libre `OTRO` no forman parte de los autocompletados de esta unidad.
- Una sugerencia de familia conserva el grupo exacto del catálogo; una sugerencia de modelo conserva el ID y nombre exactos del producto. La UI identifica por separado `Familia de máquinas`, `Modelo` y `producto válido`.
- `cliente_sistemas` se consulta exclusivamente con `.in(cliente_id, <clientes ya autorizados>)`. El resultado vuelve a intersectarse con esos IDs antes de filtrar.
- El backend no ofrece un filtro agregado de equipos por cliente. La UI carga todas las filas autorizadas por lotes y calcula filtro, lista y total con el mismo arreglo. Si falla la lectura de sistemas, el filtro queda deshabilitado y no se simula un resultado vacío.

## Filtros y paginación

- Búsqueda, agente, estados secundarios y equipo se aplican antes de paginar.
- `count` y filas visibles comparten `ST.rows`; no se mezclan totals de otra consulta.
- Página predeterminada: 10. Alternativas: 20 y 40.
- Los filtros secundarios viven en un popup con borrador, Aplicar/Limpiar, Escape, retorno de foco y estado persistido en URL.

## Seguridad pendiente

`CLIENT_RLS_BLOCKED=YES`

El contrato integral de owners/grants/RLS de `cliente_sistemas`, contactos y supervisor sigue pendiente. Esta unidad no modifica policies, no ejecuta SQL remoto y no añade escrituras frontend.
