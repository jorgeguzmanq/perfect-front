---
name: perfect-front
description: Comentar el front en vivo con Perfect Front y resolver después esos comentarios desde el código. La CLI `perfect-front` (alias `comment`) levanta el proyecto con una capa de comentarios (Alt+clic sobre un elemento) y guarda todo en `<proyecto>/.perfect-front/`; el agente lista, reclama, corrige el código y registra la resolución con `resolve`. Activates on "perfect-front", "perfect front", "comentarios visuales", "comentarios del front", ".perfect-front", "resolver comentarios", "agent-inbox", "enviar a agente", "pf watch".
---

# perfect-front — comentarios visuales sobre el front en vivo

Una persona comenta elementos de la página corriendo (capa de Alt+clic) y los comentarios quedan en `<proyecto>/.perfect-front/`. Tu trabajo: leerlos, cambiar el código del proyecto, verificar y registrar la resolución. **Ningún comando de la CLI modifica el código**: lo cambias tú y después llamas a `resolve`.

Contrato completo y siempre vigente: `packages/cli/AGENTS.md` del repo perfect-front (en caso de duda, ese archivo manda sobre este resumen).

## 0. Dónde vive todo

- Comentarios: `.perfect-front/comments/<coleccion>/<id>.json` (por defecto `inbox`; los resueltos van a `resolved`). Adjuntos y capturas: `.perfect-front/attachments/`.
- Grupos de lectura: `.perfect-front/groups.json` (solo nombre, nota y `readFirst`). La pertenencia y el orden de la cola viven en `comment.group` (`id`, `position`, 1-based) de cada comentario.
- Peticiones «Enviar a agente» del widget: `.perfect-front/agent-inbox/<requestId>.json` (`pending` → `taken` → `done`).
- Ejecutar siempre desde la carpeta del proyecto (o con `--cwd <dir>`); debe existir `.perfect-front/`. Sin comando global: `node Z:\Dev\perfect-front\packages\cli\bin\comment.mjs <comando>`.
- `<id>` acepta el ID completo (`pf_` + 26 caracteres) o un prefijo único.

## 1. Levantar el proyecto (lo hace la persona, o tú si te lo piden)

- `perfect-front` en la carpeta del proyecto: detecta el framework, arranca el dev server, el servidor local y el proxy con la capa; imprime la URL (la del proxy). Corre en primer plano; Ctrl+C lo apaga todo.
- `--detach` lo deja en segundo plano; `status`, `stop`, `restart`, `logs` lo administran.
- **Modo archivo**: `perfect-front <archivo.html>` revisa ese HTML suelto (raíz = su carpeta; comentarios en `<carpeta>/.perfect-front/`). Sin runner conocido, una carpeta con `.html` se sirve sola (`--page <ruta>` para elegir la página).
- `perfect-front prompt [--copy] [--json]` (alias `agent-prompt`) reimprime el prompt con las rutas reales del proyecto; no necesita servidor.

## 2. Comandos (todos aceptan `--json`; stdout es UN objeto JSON)

| Comando | Qué hace |
|---|---|
| `list [--status pending\|in_progress\|resolved\|ignored\|archived\|all] [--collection c] [--q texto]` | Por defecto solo `pending`. |
| `show <id>` | Comentario completo: `location` (route, url, selector, selectorCandidates, text, html, componentHint), `viewport`, `elementRect`, `attachments`, `sections`, `extraTargets`, `proposals`, `group`, `updatedAt`. |
| `claim <id>` | `pending` → `in_progress`. |
| `resolve <id> --summary "..." [--files a,b] [--verification "..."]... [--commit sha] [--by agent]` | Registra la resolución y mueve a `resolved`. |
| `edit <id> --comment "..."` | Cambia el texto (para dejar notas de resultado parcial). |
| `status <id> pending\|in_progress\|ignored\|archived` | Cambia estado (resolver = `resolve`). |
| `ignore <id>` / `reopen <id>` | `ignored`; o vuelve a `pending`. |
| `move <id...> --to <coleccion>` | Mueve a una colección existente. |
| `delete <id> --yes` | Borra el comentario y sus adjuntos. **Nunca** sin que la persona lo pida. |
| `export --format md [--status s] [--out archivo.md]` | Markdown (el `--out` debe quedar dentro de `.perfect-front`). |
| `watch [--once] [--interval ms]` | Espera peticiones «Enviar a agente» (ver §4). |

Bloqueo optimista: `--expect-updated-at <iso>` (alias `--rev`) con el `updatedAt` leído en `show`/`list`; si cambió, sale con 7 (`stale_revision`) sin tocar nada: vuelve a leer y decide de nuevo.
Códigos de salida: 0 ok, 2 uso/validación, 3 sin `.perfect-front`, 6 id no encontrado, 7 conflicto, 8 datos ilegibles. Un JSON corrupto no rompe `list`: aparece en `errors`.

## 3. Flujo para resolver un comentario

1. `perfect-front list --json` y elegir (anota `updatedAt`).
2. `perfect-front claim <id> --expect-updated-at <updatedAt>`.
3. `perfect-front show <id> --json` y localizar el elemento, de más a menos confianza: **ruta** (`location.route`/`url` → página del framework) → **texto** (`location.text` y el comentario, grep literal o clave i18n) → **selectores** (`selector`, `selectorCandidates`; ignora clases generadas) → **HTML** (`location.html`, `componentHint`) → **captura** (`attachments`: abre la imagen con Read; `viewport`/`elementRect` dicen en qué tamaño se vio).
4. Si el comentario trae `extraTargets`, es UNA tarea sobre todos esos elementos (el principal es `location`). Si trae `proposals` (texto fijo/dinámico/i18n, estilos, reordenamiento) son cambios propuestos por la persona: aplícalos tal cual y respeta su `source` (archivo:línea) cuando exista. Las `sections` son bloques con texto e imágenes propios.
5. Cambia el código (donde nace el valor, no donde se ve; tokens antes que valores sueltos), verifica (build, lint, tests o inspección visual) y registra: `perfect-front resolve <id> --summary "qué y por qué" --files a,b --verification "pnpm build ok" --by agent`.

### Grupos y cola

Si el comentario tiene `group`, pertenece a un grupo de lectura: lee su `name`, `note` y `readFirst` en `.perfect-front/groups.json`. Con `readFirst: true` lee la nota y toda la cola del grupo ANTES de tocar nada. Atiende los comentarios del grupo en orden de `group.position` y no empieces uno hasta resolver y verificar el anterior; si uno no se puede cerrar, los siguientes del grupo quedan abiertos con la razón. Grupos distintos son independientes.

### Si no localizas el elemento con confianza

No adivines. Deja el comentario abierto con el resultado parcial: `perfect-front edit <id> --comment "<texto original>\n\n[Agente] No localizado: probé X, Y; candidatos: src/a.tsx:42. Falta: ..."` (conservando siempre el texto original) y `claim` si hay trabajo avanzado, o `status <id> pending`. Si hay ambigüedad de producto, pregunta a la persona en vez de resolver. `ignore` solo si la persona lo indicó o el comentario ya no aplica.

## 4. Peticiones del widget: `watch` bajo Monitor

El botón «Enviar a agente» hace `POST /api/projects/:id/agent/requests` y el servidor escribe `.perfect-front/agent-inbox/<id>.json`. Con la sesión abierta, corre `perfect-front watch` (sin `--once`) bajo Monitor: por cada petición pendiente imprime `Petición <id>: N comentario(s) → ids` y el prompt entre `───── PROMPT PARA TU AGENTE ─────` y `───── FIN ─────`, y la marca `taken`. El prompt solo trae ids, conteo, grupo y rutas: el contenido lo lees con `list`/`show`. Atiende cada petición con `claim` → `resolve`. `--once` sale tras la primera petición.

## 5. Reglas duras

- El CLI no cambia código: lo haces tú. Cero `git commit/push` salvo que la persona lo pida.
- Un comentario sin verificar no se resuelve. No borres comentarios por tu cuenta; resolver = `resolve`.
- Respeta el CLAUDE.md/AGENTS.md del proyecto comentado (estilo, tokens, copy en el idioma que defina).
- Cambio de contenido: literal exacto, sin «mejorar» el copy.
- El `.perfect-front/` es del flujo de comentarios: no lo edites a mano (usa la CLI) y no pegues el token del servidor ni `discovery.json` en ningún lado.
