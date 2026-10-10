# @perfect-front/shared

Contratos estables compartidos por CLI, servidor, dashboard y extensión: esquemas Zod y tipos inferidos (`z.infer`). Sin dependencias de filesystem ni de navegador (solo `globalThis.crypto` para generar IDs).

```ts
import { VisualCommentSchema, migrateComment, type VisualComment } from "@perfect-front/shared";
const comment = migrateComment(JSON.parse(raw)); // valida y migra datos desconocidos (v1 o v2)
```

## Contenido (`src/`)

- `ids.ts`: `ProjectId`, `CommentId`, `CollectionName`, `AttachmentPathSchema`, `GroupIdSchema`, `LocalIdSchema`, `generateCommentId`.
- `timestamps.ts`: `Timestamp` ISO-8601 UTC (sufijo `Z`).
- `config.ts`: `ProjectConfig` v1 (`.perfect-front/project.json`).
- `comment.ts`: `VisualComment` v2 (`COMMENT_VERSION = 2`) y `VisualCommentV1Schema` (solo para migrar). Incluye estados, scopes, ubicación, viewport, rect, ambiente, resolución y los bloques v2: secciones, adjuntos con metadatos, `extraTargets`, `proposals`, `group`, y el grupo de lectura `ReadingGroup`.
- `api.ts`: requests y responses de la API local. Las requests son `.strict()`.
- `limits.ts`: `LIMITS`, todos los límites de tamaño.
- `locationRef.ts`: `formatLocationRef`, función pura para «copiar ubicación» (formatos `file`, `selector`, `pf`, `markdown`).
- `events.ts`: eventos de proyecto, comentario, colección y proceso.
- `errors.ts`: `PerfectFrontError` y errores serializables con código estable.
- `migrate.ts`: `migrateComment`, `migrateProjectConfig`, `LATEST_COMMENT_VERSION` (2).

## Versión 2 del comentario (`version: 2`)

`VisualComment` pasa de `version: 1` a `version: 2`. Los campos nuevos son obligatorios en disco (`migrate.ts` los rellena al migrar v1).

### Secciones

- `sections[]`, máximo 20 (`LIMITS.sections`). Cada sección: `{ id, title, text, attachments[] }`.
- `title` admite `null` (máx. 120); `text` máx. 5.000.
- `comment` sigue siendo el texto principal del comentario.
- Un adjunto solo puede estar en una sección. Un adjunto sin sección queda suelto.
- En la creación, las secciones llegan en `sections` sin `attachments` (`NewSectionSchema`). Las imágenes se declaran en `uploads` con `sectionId`.
- En PATCH, `sections` reemplaza la lista completa. Es la vía para reubicar imágenes entre secciones: solo se aceptan rutas que el comentario ya tiene.

### Adjuntos

- `attachments[]` sigue siendo la lista canónica de rutas `attachments/<archivo>`. Máximo 20 por comentario (`LIMITS.attachments`), sumando secciones y sueltos.
- `attachmentInfo[]` guarda `{ path, name, source, mimeType, bytes }`, sin duplicar rutas. `name` máx. 200.
- `source`: `paste`, `drop`, `open` o `capture`.
- `mimeType`: `image/png`, `image/jpeg` o `image/webp`.
- Subidas (`AttachmentUploadSchema`): `clientId` único dentro de la request, `name`, `source`, `sectionId` (`null` = suelto) y `dataBase64` (máx. 10.000.000 caracteres por archivo).
- Límite conjunto de todas las subidas de una request: 13.000.000 caracteres base64 (`LIMITS.uploadsBase64`).
- Captura heredada de v1 (`screenshot`): cuenta como un adjunto más, con origen `capture` suelto.
- PATCH nunca borra archivos. Una ruta que queda fuera de todas las secciones pasa a suelta.

### Multiselección

- `extraTargets[]`, máximo 19 (`LIMITS.extraTargets`). Es el resto de la selección; el elemento principal sigue en `location` y `elementRect`.
- Cada elemento: `{ id, selector, selectorCandidates, text, html (máx. 4.000), componentHint, source?, elementRect }`.
- `scope: "view"` no admite `extraTargets` (regla de `refineV2Parts`).
- `id` único dentro del comentario.

### Propuestas

- `proposals[]`, máximo 50 (`LIMITS.proposals`). Son datos del comentario: los esquemas no tienen ninguna operación que escriba en el proyecto observado.
- `targetSelector`: selector del elemento propuesto, o `null` para el elemento principal de `location`. Con `scope: "view"` es obligatorio.
- Tipos (`kind`):
  - `text_fixed`: `before` → `after` (máx. 2.000 cada uno), `source?`.
  - `text_dynamic`: igual, más `variables` (máx. 20). Cada variable debe aparecer como `{nombre}` en `after`.
  - `text_i18n`: `key`, `library`, `uses`, `scope` (`all` o `one`), `newKey` (obligatorio si `scope: "one"`), y `locales[]` (máx. 12) con `{ locale, before (null = sin traducir), after }`. No se admiten idiomas duplicados.
  - `style`: `appliesTo` (`focus` o `all`) y `changes[]` (máx. 50) con `{ property, before, after, origin, source?, token? }`. `before`/`after` máx. 500. `origin`: `editable` (valor modificable) o `foundation` (token, reset o preflight, solo referencia).
  - `reorder`: `parentSelector`, `from`, `to` y `siblingCount` (máx. 1.000). Posiciones 1-based, `from ≠ to`, y ambas dentro de `siblingCount`.
- `note` es opcional, máx. 2.000.

### Grupos de lectura

- `group: { id, position } | null` en el comentario. `position` es 1-based, máx. 200 (`LIMITS.groupItems`).
- Nombre, nota y `readFirst` viven en `ReadingGroup`: `name` máx. 120, `note` máx. 5.000, `readFirst` booleano (por defecto `true` al crear).
- La cola es el orden por `position`.
- Reordenar (`ReorderGroupRequest`): `order[i]` pasa a `position = i + 1`. Los ids no pueden repetirse. Los comentarios que no aparecen en `order` salen del grupo.

### Reglas de `scope` y estado

- `scope: "element"` exige `location.selector` y `elementRect`.
- `resolution` solo puede existir con `status` `resolved` o `archived`.

## Límites (`LIMITS`, `limits.ts`)

| Límite | Valor | Novedad v2 |
|---|---|---|
| `comment` | 10.000 | no |
| `html` | 20.000 | no |
| `text` | 2.000 | no |
| `selector` | 1.000 | no |
| `selectorCandidates` | 20 | no |
| `sections` | 20 | sí |
| `sectionTitle` | 120 | sí |
| `sectionText` | 5.000 | sí |
| `attachments` | 20 | sí |
| `attachmentName` | 200 | sí |
| `extraTargets` | 19 | sí |
| `extraTargetHtml` | 4.000 | sí |
| `proposals` | 50 | sí |
| `proposalText` | 2.000 | sí |
| `styleChanges` | 50 | sí |
| `styleValue` | 500 | sí |
| `i18nLocales` | 12 | sí |
| `textVariables` | 20 | sí |
| `groupName` | 120 | sí |
| `groupNote` | 5.000 | sí |
| `groupItems` | 200 | sí |
| `uploadsBase64` | 13.000.000 | sí |

## Migración v1 → v2

`migrateComment(input)` (`migrate.ts`):

1. Lee `version`. Ausente, no entero o menor que 1: `invalid_data`.
2. Versión mayor que 2: `unsupported_version` con mensaje para actualizar Perfect Front.
3. Versión 1: valida con `VisualCommentV1Schema` (`.strict()`) y añade `version: 2`, `attachmentInfo: []`, `sections: []`, `extraTargets: []`, `proposals: []`, `group: null`.
4. Valida el resultado con `VisualCommentSchema`.

Consecuencias de la migración:

- Los adjuntos v1 quedan sueltos (sin sección) y sin metadatos.
- Es pura: no escribe a disco. Quien lee decide si reescribe el archivo.
- `CreateCommentRequestSchema` acepta `version` 1 o 2. Un cliente v1 no envía los campos nuevos y recibe los valores por defecto (`[]`, `null`).

## Observaciones para revisar

- `SPEC.md` §6.3 dice que `location.source` puede llevar `{ file, line }`. `CommentLocationSchema` es `.strict()` y no tiene `source`. El origen `{ file, line }` existe en `extraTargets[].source`, en `source` de las propuestas `text_*` y en `changes[].source` de las propuestas `style`. Las propuestas `reorder` no lo llevan.
- Los formatos MIME del código son `png`, `jpeg` y `webp`. El prototipo `.design/overlay-layer.html` muestra GIF como admitido. El esquema no admite GIF.
- `refineUploads` cuenta el límite de 20 solo con las subidas de la request y la captura. En PATCH no ve los adjuntos ya existentes, así que el límite total de 20 no puede comprobarse solo con los esquemas; la comprobación depende del almacenamiento.
- La versión anterior de este README decía «VisualComment v1». Se corrigió a v2.
