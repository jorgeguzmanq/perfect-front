# @perfect-front/shared

Contratos estables compartidos por CLI, servidor, dashboard y extensión: esquemas Zod y tipos inferidos (`z.infer`). Sin dependencias de filesystem ni de navegador (solo `globalThis.crypto` para generar IDs).

```ts
import { VisualCommentSchema, migrateComment, type VisualComment } from "@perfect-front/shared";
const comment = migrateComment(JSON.parse(raw)); // valida y migra datos desconocidos
```

## Contenido (`src/`)

- `ids.ts`: `ProjectId`, `CommentId`, `CollectionName`, `AttachmentPathSchema`, `generateCommentId`.
- `timestamps.ts`: `Timestamp` ISO-8601 UTC (sufijo `Z`).
- `config.ts`: `ProjectConfig` v1 (`.perfect-front/project.json`).
- `comment.ts`: `VisualComment` v1, estados, scopes, ubicación, viewport, rect, ambiente, resolución.
- `api.ts`: requests/responses de la API local.
- `events.ts`: eventos de proyecto, comentario, colección y proceso.
- `errors.ts`: `PerfectFrontError` y errores serializables con código estable.
- `migrate.ts`: `migrateComment`, `migrateProjectConfig`.

## Seguridad de identificadores

`ProjectId`, `CommentId`, `CollectionName` y adjuntos son aptos como nombre de archivo en Windows, macOS y Linux: rechazan rutas absolutas, `..`, separadores (`/`, `\`), `:`, caracteres de control, nombres reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) y puntos finales. Colecciones: `[a-z0-9][a-z0-9_-]*`, máx. 64. `CommentId`: `pf_` + base32 Crockford en mayúsculas; los generados son ordenables por fecha de creación. Los esquemas de límites de seguridad (requests, config, comentario) son `.strict()`: las propiedades desconocidas se rechazan.

## Compatibilidad hacia atrás de los JSON

- Cada documento persistido lleva `version` (entero). Hoy `ProjectConfig` y `VisualComment` están en `1`.
- Reglas de evolución:
  - Cambios aditivos y opcionales no suben versión mientras el lector antiguo siga válido; como los esquemas son `.strict()`, un campo nuevo SIEMPRE requiere subir `version`.
  - Todo cambio incompatible o campo nuevo sube `version` y añade un paso en `migrate.ts` (v1 → v2 → …) que se encadena hasta `LATEST_*_VERSION`.
  - Las migraciones son puras y no escriben a disco; quien lee decide si reescribe el archivo.
- Una versión más nueva que la soportada produce `PerfectFrontError` con código `unsupported_version` y un mensaje que indica actualizar Perfect Front. Versión ausente o no entera: `invalid_data`.
- Los códigos de error (`ERROR_CODES`) son estables: solo se añaden, nunca se renombran. `message` es seguro para mostrar; `details` lista `path` + mensaje de validación, nunca valores recibidos.
- Los tipos de evento y los endpoints de `api.ts` siguen el mismo criterio; `apiVersion` del health check es `1`.
