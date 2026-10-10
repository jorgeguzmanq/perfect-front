# Comment storage

Persistencia atómica de un JSON por comentario, colecciones físicas, adjuntos, movimiento, resolución y exportación.

Implementación en `src/` (repository, service, markdown, grupos en `groups.ts`). Ver SPEC §6.3 y `PLAN.md`.

## Contratos v2 que debe respetar

Los contratos son los de `@perfect-front/shared` (`comment.ts`, `api.ts`), versión 2 del comentario (ver `packages/shared/README.md`):

- Cada comentario se escribe como `version: 2`. Al leer un JSON v1, usar `migrateComment` (campos nuevos vacíos, adjuntos sueltos); no reescribir el archivo sin decidirlo.
- `attachments[]` es la lista canónica de rutas. Máximo 20 por comentario, sumando secciones y sueltos. `attachmentInfo[]` debe tener una entrada por ruta, sin duplicados.
- Un adjunto solo puede estar en una sección. Sin sección = suelto.
- Un PATCH con `sections` reemplaza la lista completa. Una ruta que queda fuera de todas las secciones pasa a suelta. Los archivos nunca se borran por PATCH.
- Las subidas (`uploads`) se guardan en `attachments/` y se atan por `sectionId`. Los `clientId` no se persisten.
- `proposals[]` se guardan con el comentario y no modifican el proyecto observado.
- `group: { id, position }` referencia un grupo de lectura. El grupo (`ReadingGroup`: nombre, nota, `readFirst`) es un documento aparte.
- Reordenar un grupo: `order[i]` pasa a `position = i + 1`; los comentarios ausentes de `order` salen del grupo.
- Las migraciones son puras. Escribir a disco sigue las reglas de la sección 6.6 de `SPEC.md` (archivo temporal, validar, renombrar).
