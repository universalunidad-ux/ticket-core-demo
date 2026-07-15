# Propuesta de alcance para respuestas rápidas

Documento de diseño; no autoriza ni ejecuta migraciones remotas.

## Modelo objetivo

| Alcance | Lectura | Escritura | Claves de ámbito |
| --- | --- | --- | --- |
| `global` | Administrador y Soporte | Sólo Administrador | ninguna |
| `producto` | Administrador y Soporte | Sólo Administrador | `product_key` canónica |
| `mia` | Sólo propietario y Administrador autorizado | Propietario; Administrador sólo bajo política explícita | `owner_user_id` |

Campos propuestos: `id`, `scope`, `modo`, `titulo`, `texto`, `orden`, `product_key`, `owner_user_id`, `tipo_envio`, `activo`, `created_at`, `updated_at`, `created_by`, `updated_by`. Restricciones: `scope IN ('global','producto','mia')`, máximo de orden por ámbito y claves nulas/no nulas coherentes con el alcance.

## RLS propuesta

- Soporte puede seleccionar Globales y de Producto, pero no insertar, actualizar ni eliminar esos alcances.
- Soporte sólo puede operar filas `mia` donde `owner_user_id = auth.uid()`.
- Administrador puede administrar Globales y Producto. El acceso a `mia` debe decidirse explícitamente antes de migrar.
- Toda operación conserva auditoría; borrar debería ser lógico (`activo = false`) cuando exista uso histórico.
- La API debe rechazar el alcance recibido si contradice el rol, aunque el control esté oculto en frontend.

## Compatibilidad y migración futura

El esquema actual usa `global`, `producto`, `cliente` y `contacto`; Producto se guarda localmente en parte del frontend. Una migración futura debe:

1. Inventariar filas y consumidores actuales sin modificarlos.
2. Añadir columnas/constraints y políticas en una migración reversible.
3. Mapear Globales existentes a `global`; normalizar producto mediante `product_key`.
4. Mantener lectura compatible de `cliente`/`contacto` durante una ventana definida o migrarlos a plantillas personales sólo con decisión de producto.
5. Activar escritura remota detrás de una bandera (`quick_reply_scopes_v2`).
6. Validar RLS con cuentas Administrador y Soporte antes de retirar la ruta antigua.

## Estado del frontend candidato

Soporte puede usar plantillas autorizadas, pero el botón de edición Global/Producto se oculta y `openQuickEditor` vuelve a comprobar `isAdmin`. Administrador conserva el editor actual. Esto es defensa de interfaz; no sustituye RLS. No se realizaron mutaciones remotas.
