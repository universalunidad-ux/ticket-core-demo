# Matriz de prueba live posterior a publicación

Esta matriz se ejecuta únicamente después de publicar la rama de revisión y con cuentas sintéticas autorizadas. No usar clientes, correos, teléfonos, archivos ni tickets reales.

## Precondiciones

- Confirmar el origen exacto de GitHub Pages en redirects y CORS.
- Confirmar RLS, grants, políticas de Storage y permisos de Edge Functions para los roles de prueba.
- Preparar una cuenta sintética `admin` y una cuenta sintética `soporte` sin reutilizar credenciales personales.
- Definir un prefijo inequívoco para todos los registros, por ejemplo `QA-LIVE-REVIEW-YYYYMMDD`.
- Acordar el procedimiento de limpieza y conservar los identificadores creados.

## Casos obligatorios

| Caso | Rol | Acción | Evidencia esperada | Limpieza |
|---|---|---|---|---|
| Login admin | admin | Iniciar sesión con la cuenta sintética | Redirección al dashboard y perfil `admin` | Logout al finalizar |
| Login soporte | soporte | Iniciar sesión con la cuenta sintética | Redirección a tickets y perfil `soporte` | Logout al finalizar |
| Listado | ambos | Abrir listado real de tickets | Sólo filas permitidas por RLS | Ninguna |
| Apertura | ambos | Abrir un ticket sintético autorizado | Detalle, historial y adjuntos permitidos | Ninguna |
| Dashboard | admin | Abrir métricas y vistas de operación | Sólo agregados y registros permitidos por el rol | Ninguna |
| Clientes | admin o rol permitido | Consultar y editar un cliente exclusivamente sintético | Lectura/escritura limitada por RLS y rol | Revertir el cambio QA |
| Creación | rol autorizado | Crear un ticket con prefijo QA | Ticket nuevo y folio registrado | Eliminar/cerrar según política QA |
| Actualización | rol autorizado | Cambiar estado/prioridad del ticket QA | Cambio persistido y auditado | Restaurar estado o cerrar |
| Respuesta | rol autorizado | Enviar respuesta sintética | Evento visible en historial público autorizado | Conservar dentro del ticket QA |
| Nota interna | rol autorizado | Agregar nota marcada interna | Visible sólo para roles autorizados | Conservar dentro del ticket QA |
| Asignación | admin o rol permitido | Asignar el ticket QA a soporte | Responsable actualizado sin ampliar acceso | Restaurar o cerrar |
| Storage | rol autorizado | Subir un TXT/PNG sintético sin datos reales | Archivo accesible sólo por la política esperada | Borrar el objeto al terminar |
| Cierre | rol autorizado | Cerrar el ticket QA | Estado final y auditoría correctos | Confirmar cierre |
| Soporte público | anónimo | Enviar un caso sintético autorizado | Edge Function devuelve folio/token | Cerrar/eliminar según procedimiento QA |
| Seguimiento | anónimo | Consultar el folio/token QA | Sólo el ticket asociado es visible | Ninguna |
| Logout | ambos | Cerrar sesión | Sesión local eliminada y rutas internas protegidas | Ninguna |

## Criterios de interrupción

Detener las pruebas y no continuar con mutaciones si se observa acceso entre clientes, elevación de rol, datos reales, URLs firmadas excesivamente amplias, escritura sin autorización, exposición de secretos o una respuesta que contradiga RLS/grants esperados.
