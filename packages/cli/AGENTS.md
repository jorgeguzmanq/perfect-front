# Perfect Front CLI: contrato para agentes

Los comentarios visuales de un proyecto viven en `<proyecto>/.perfect-front/comments/<coleccion>/<id>.json` (adjuntos en `.perfect-front/attachments/`). Estos subcomandos operan DIRECTO sobre esa carpeta: no necesitan servidor local, navegador ni dashboard. **Ningun comando modifica el codigo del proyecto**: tu cambias el codigo y despues registras la resolucion con `resolve`.

Binario: `perfect-front` (alias `comment`). Sin instalacion global: `node Z:\Dev\perfect-front\packages\cli\bin\comment.mjs <comando>`. La raiz del proyecto se detecta desde el directorio actual (o `--cwd <dir>`) y debe tener `.perfect-front/`.

## Reglas de salida

- Con `--json`, stdout contiene SIEMPRE un unico objeto JSON valido (una linea). Exito: `{"ok":true,...}`. Error: `{"ok":false,"error":{"code","message"}}` con el codigo de salida correspondiente. Sin colores ni prompts (nunca pregunta nada).
- Sin `--json` la salida es texto para personas (tabla compacta); los avisos van a stderr.
- `<id>` acepta el ID completo (`pf_` + 26 caracteres) o un prefijo unico, sin distinguir mayusculas. Prefijo ambiguo = error de uso (2).

## Comandos

| Comando | Efecto |
|---|---|
| `list [--status pending\|in_progress\|resolved\|ignored\|archived\|all] [--collection c] [--q texto] [--json]` | Por defecto SOLO `pending` (usa `--status in_progress` o `all` para el resto). |
| `show <id> [--json]` | Datos completos para localizar el elemento. |
| `claim <id>` | `pending` -> `in_progress` (conflicto 7 si no estaba pending). |
| `resolve <id> --summary "..." [--files a,b] [--verification "..."]... [--commit sha] [--by agent\|human]` | Registra la resolucion, estado `resolved` y mueve a la coleccion de resueltos (`resolved` por defecto). `--verification` se puede repetir. Conflicto 7 si ya estaba resolved/archived. |
| `edit <id> --comment "..."` | Cambia el texto del comentario. |
| `move <id...> --to <coleccion>` | Mueve a una coleccion existente. |
| `status <id> pending\|in_progress\|ignored\|archived` | Cambia el estado (para resolver usa `resolve`). `status` sin id es el estado del servidor. |
| `ignore <id>` / `reopen <id>` | `ignored`; o vuelve a `pending` (limpia la resolucion y regresa a la coleccion por defecto si estaba en resolved/archived). |
| `export --format md [--status s] [--collection c] [--out archivo.md]` | Markdown a stdout, o a un `.md` DENTRO de `.perfect-front` (relativo a esa carpeta; traversal, rutas externas y otras extensiones se rechazan con 2). |

Bloqueo optimista: en `edit`, `move`, `resolve`, `ignore`, `reopen`, `claim` y `status` se puede pasar `--expect-updated-at <iso>` (alias `--rev`) con el `updatedAt` que leiste en `show`/`list`. Si el comentario cambio, falla con codigo 7 (`stale_revision`) sin modificar nada: vuelve a leerlo con `show` y decide de nuevo. (La comprobacion y la escritura no son atomicas entre procesos: reduce, no elimina, la carrera.)

## Codigos de salida (estables)

| Codigo | Significado | `error.code` tipico |
|---|---|---|
| 0 | OK | |
| 1 | Error interno | `internal_error` |
| 2 | Uso o validacion (opcion invalida, falta argumento, id invalido o ambiguo, valor fuera de rango, `--out` fuera de `.perfect-front`) | `invalid_request`, `invalid_id`, `ambiguous_id`, `invalid_collection` |
| 3 | Proyecto o carpeta `.perfect-front` no encontrados | `project_not_found` |
| 4, 5, 130 | Ya existentes del CLI (proceso / nada en ejecucion / Ctrl+C); no los emiten estos subcomandos | |
| 6 | Id (o coleccion destino) no encontrado | `not_found` |
| 7 | Conflicto: revision obsoleta o transicion no permitida | `stale_revision`, `conflict` |
| 8 | Datos ilegibles/invalidos o error de almacenamiento | `invalid_data`, `unsupported_version`, `storage_error` |

Nota: 4 y 5 ya significaban "proceso" y "no activo" en el CLI, por eso "no encontrado" es 6 y "conflicto" es 7.

Un JSON corrupto dentro de `comments/` NO rompe `list`: se omite y se informa en `errors` (JSON) o en stderr.

## JSON de salida

`list --json`:

```json
{"ok":true,"command":"list","root":"C:/proj","status":"pending","count":1,
 "comments":[{"id":"pf_...","shortId":"pf_01K9ZQ3A7B2C4D","status":"pending","collection":"inbox","scope":"element",
   "route":"/pricing","url":"http://localhost:5173/pricing","title":"Pricing","selector":"main > button.cta",
   "text":"Cambia el color","createdAt":"...","updatedAt":"...","resolvedAt":null}],
 "errors":[{"collection":"inbox","file":"x.json","code":"invalid_data","message":"..."}]}
```

`show --json`: `{"ok":true,"command":"show","root","pfDir","comment":<comentario completo>,"attachments":[{"path":"attachments/pf_X.png","absolutePath":"...","exists":true}]}`. `comment` incluye:

- `location`: `url`, `route`, `title`, `selector`, `selectorCandidates[]`, `text` (texto del elemento), `html` (HTML limitado, como texto), `componentHint`.
- `viewport` (`width`, `height`, `devicePixelRatio`, `scrollX`, `scrollY`), `elementRect` (`x`, `y`, `width`, `height`), `scope` (`element` | `view`), `environment`.
- `attachments[]` (rutas relativas a `.perfect-front`), `createdAt`, `updatedAt` (usalo para `--expect-updated-at`), `resolution` (`resolvedAt`, `resolvedBy`, `summary`, `filesChanged[]`, `verification[]`, `commit`) o `null`.

Comandos que modifican (`claim`, `edit`, `resolve`, `ignore`, `reopen`, `status`): `{"ok":true,"command":...,"comment":<completo>,"summary":<como en list>}`. `move`: `{"ok":true,"command":"move","to":"c","results":[{"id","ok":true,"comment","summary"}]}`; si algun id falla, `ok:false`, `error` del primero y `results` con el detalle por id (el codigo de salida es el del primer fallo). `export`: `{"ok":true,"command":"export","format":"md","count":n,"markdown":"..."}` o, con `--out`, `"file":"exports/x.md"` en lugar de `markdown`.

## Flujo recomendado

1. `perfect-front list --json` y elegir un comentario (anota su `updatedAt`).
2. `perfect-front claim <id> --expect-updated-at <updatedAt>` (opcional, evita que dos agentes tomen el mismo).
3. `perfect-front show <id> --json` y localizar el elemento en el codigo, en este orden de confianza:
   1. **Ruta**: `location.route` (y `url`) -> pagina/ruta del framework (p. ej. `app/pricing/page.tsx`, `pricing.html`).
   2. **Texto**: `location.text` y el texto del comentario -> buscar la cadena literal (o su clave i18n) con grep.
   3. **Selectores**: `selector` y `selectorCandidates` -> ids, clases, `data-testid`, atributos; ignora clases generadas (hashes de CSS Modules, utilidades Tailwind sueltas).
   4. **HTML**: `location.html` -> estructura y atributos para distinguir entre varias coincidencias; `componentHint` si existe.
   5. **Captura**: si hay `attachments`, abre la imagen (`absolutePath`) para confirmar el elemento y el cambio esperado. `viewport`/`elementRect` dicen en que tamano de pantalla se vio.
4. Cambiar el codigo (el CLI no lo hace) y verificar (build, typecheck, lint, tests o inspeccion visual segun el proyecto).
5. `perfect-front resolve <id> --summary "que se cambio y por que" --files src/a.tsx,src/b.css --verification "pnpm build ok" --by agent [--commit sha] [--expect-updated-at <updatedAt>]`.

## Si no localizas el elemento con confianza

No adivines ni toques codigo al azar. Registra el resultado parcial y deja el comentario abierto:

- Si avanzaste algo: `perfect-front edit <id> --comment "<texto original>\n\n[Agente] No localizado con confianza: probe X, Y; candidatos: src/a.tsx:42 (tiene 'Buy' pero hay 3 coincidencias). Falta: confirmar cual pagina."` y deja el estado en `in_progress` (`claim`) para que otros sepan que hay trabajo parcial.
- Si no hay nada que hacer todavia: `status <id> pending` con el mismo tipo de nota en el comentario.
- Conserva siempre el texto original al editar. Si el cambio es ambiguo, en lugar de resolver pide la decision a la persona.
- Solo usa `resolve` cuando el cambio este hecho y verificado; usa `ignore` solo si la persona lo indico o el comentario ya no aplica (explicalo en tu respuesta).

## Bloque para pegar en el CLAUDE.md / AGENTS.md de un proyecto

```markdown
## Comentarios visuales (Perfect Front)

Para aplicar comentarios visuales: ejecuta `perfect-front list --json` (solo pendientes; `--status in_progress|all` para otros).
Por cada comentario: `perfect-front claim <id>`, luego `perfect-front show <id> --json` y localiza el elemento por
`location.route`, `location.text`, `selector`/`selectorCandidates` y `location.html` (si hay `attachments`, mira la captura).
Cambia el codigo, verifica (build/lint/tests) y registra con
`perfect-front resolve <id> --summary "..." --files a,b --verification "..." --by agent`.
Si no localizas el elemento con confianza, NO lo resuelvas: anota el resultado parcial con `perfect-front edit <id> --comment "..."`
(conservando el texto original) y deja el estado en `in_progress` o `pending`.
Usa `--expect-updated-at <iso>` para no pisar cambios ajenos. Codigos de salida: 0 ok, 2 uso, 3 sin proyecto, 6 id no
encontrado, 7 conflicto/revision obsoleta, 8 datos. Contrato completo: packages/cli/AGENTS.md del repo perfect-front.
```
