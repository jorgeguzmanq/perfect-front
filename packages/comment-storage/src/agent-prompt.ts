import path from "node:path";

/**
 * Prompt para pegar a un agente de código (Claude Code, Codex...) con los datos reales de la sesion.
 * UNICA fuente: lo usan el arranque (primer plano y start/--detach), `--json` (campo `agentPrompt`)
 * y el subcomando `prompt`. El contrato detallado de los subcomandos vive en `agentsDoc` (packages/cli/AGENTS.md).
 * Nunca recibe ni imprime el token del servidor local ni discovery.json.
 */

export interface AgentPromptContext {
  /** Raíz absoluta del proyecto. */
  root: string;
  /** URL del proyecto bajo el proxy (la que se abre), si hay. */
  url?: string | null;
  /** URL original del dev server (si hay proxy, distinta de `url`). */
  targetUrl?: string | null;
  /** Comando de la CLI tal como debe teclearse (por defecto `perfect-front`). */
  cli?: string;
  /** Ruta absoluta de packages/cli/AGENTS.md (contrato completo), si se conoce. */
  agentsDoc?: string | null;
}

export const PROMPT_BEGIN = "───── PROMPT PARA TU AGENTE ─────";
export const PROMPT_END = "───── FIN ─────";

/** Bloque delimitado para imprimir en terminal. */
export function formatPromptBlock(prompt: string): string {
  return `${PROMPT_BEGIN}\n${prompt.replace(/\n+$/, "")}\n${PROMPT_END}`;
}

export function buildAgentPrompt(ctx: AgentPromptContext): string {
  const cli = ctx.cli ?? "perfect-front";
  const root = path.resolve(ctx.root);
  const pf = path.join(root, ".perfect-front");
  const comments = path.join(pf, "comments");
  const attachments = path.join(pf, "attachments");
  const groups = path.join(pf, "groups.json");
  const page = ctx.url ?? ctx.targetUrl ?? null;
  const original = ctx.targetUrl && ctx.targetUrl !== page ? ctx.targetUrl : null;

  const L: string[] = [];
  const add = (...s: string[]): void => void L.push(...s);

  add(
    "Eres un agente de código. Vas a aplicar comentarios visuales hechos con Perfect Front sobre la app web que corre en este proyecto.",
    "",
    "## Qué es esto",
    "Perfect Front pone una capa de comentarios sobre la app en ejecucion. Cada comentario que dejo la persona es una TAREA VISUAL sobre un elemento (o una vista) de esa app: texto, estilos, orden de elementos, eliminar algo, etc. Tu trabajo es cambiar el código del proyecto para cumplirlas.",
    "",
    "## Rutas de esta sesión (absolutas)",
    `- Raíz del proyecto: ${root}`,
    `- Datos de Perfect Front: ${pf}  (un comentario = un archivo JSON en ${path.join(comments, "<coleccion>", "<id>.json")})`,
    `- Adjuntos y capturas (imágenes PNG/JPEG/WebP, nombre pf_<id>[-n].<ext>): ${attachments}`,
    `- Grupos de lectura (nombre y nota de cada grupo): ${groups}`,
    ...(page ? [`- URL del proyecto (con la capa, via proxy): ${page}`] : ["- URL del proyecto: no disponible (el dev server no está activo; arráncalo con `" + cli + "`)"]),
    ...(original ? [`- URL original (dev server): ${original}`] : []),
    ...(ctx.agentsDoc ? [`- Contrato completo de la CLI: ${ctx.agentsDoc}`] : []),
    "",
    "## 1. Revisar",
    `Ejecuta los comandos desde la raíz del proyecto (o agrega --cwd "${root}"). No necesitan servidor ni navegador. Con --json la salida es un único objeto JSON.`,
    `- \`${cli} list --json\`  lista los PENDIENTES (por defecto). Filtros: --status pending|in_progress|resolved|ignored|archived|all, --collection <c>, --q <texto>.`,
    `- \`${cli} show <id> --json\`  comentario completo (el <id> acepta prefijo único). Incluye \`updatedAt\` y \`attachments[]\` con \`absolutePath\`.`,
    `- No hay filtro por ruta ni por grupo en la CLI: filtra el JSON de \`list\` por \`route\` y lee \`group\` en \`show\`.`,
    "",
    "Cómo leer un comentario (versión 2):",
    "- `comment` es el texto principal; `sections[]` son bloques con su propio `title`, `text` e imágenes (`attachments` de cada seccion). Lee TODAS las secciones.",
    `- Adjuntos: abre cada imagen (\`attachments[].absolutePath\`, bajo ${attachments}) y mírala: la captura confirma el elemento y el resultado esperado. \`attachmentInfo[]\` da nombre original y origen.`,
    "- Elemento: `location.selector` + `location.selectorCandidates`, `location.text`, `location.html`, `location.componentHint`, `location.route` y `viewport`/`elementRect` (tamano de pantalla en que se vio). `scope` es `element` o `view` (vista completa).",
    "- archivo:línea: aparece en `source` (`file`, `line`) dentro de las propuestas y de `extraTargets`; úsalo como primera pista.",
    "- Multiselección: el elemento principal es `location`; el resto está en `extraTargets[]` (cada uno con su selector, texto y `source`). El cambio aplica a todos.",
    "- `proposals[]` (propuestas de la persona; son la especificacion, aplícalas):",
    "  - `text_fixed` / `text_dynamic`: texto `before` -> `after` (en dinamico conserva las `variables` como {nombre}).",
    "  - `text_i18n`: clave `key` (o `newKey` si `scope` es `one`) y `locales[]` con `before` -> `after` por idioma; edita los archivos de traducción de TODOS los idiomas listados.",
    "  - `style`: `changes[]` con `property` `before` -> `after`; `origin: editable` = cambia el valor de origen (`source`/`token`); `foundation` = token/reset, solo referencia, no lo edites a ciegas.",
    "  - `reorder`: «mover de X a Y» (posiciones 1-based entre `siblingCount` hermanos de `parentSelector`).",
    "  - `targetSelector: null` = el elemento principal.",
    "- Un comentario cuyo texto es «Eliminar este elemento.» pide quitar ese elemento (y sus restos: estilos, imports y rutas que queden huerfanos si estan claramente ligados).",
    `- Grupos: si el comentario trae \`group\` ({id, position}), lee la nota del grupo en ${groups} (si \`readFirst\` es true es obligatorio) y despues TODOS los comentarios del grupo ordenados por \`group.position\` ANTES de actuar sobre ningúno. La cola se ejecuta en ese orden.`,
    "",
    "## 2. Investigar (no asumas)",
    "- Localiza el componente por archivo:línea (`source`), luego por selector/texto/clave i18n con grep, y descarta clases generadas (hashes de CSS Modules, utilidades sueltas).",
    ...(page ? [`- Abre ${page} en el navegador y comprueba el estado actual del elemento y de sus vecinos; compara con las imágenes adjuntas.`] : ["- Cuando la app este activa, abre su URL y compara el estado actual con las imágenes adjuntas."]),
    `- Reglas: NO edites nada dentro de ${pf} a mano (usa solo los subcomandos de la CLI); los cambios de código SÍ van en el proyecto (${root}). La CLI nunca modifica el código.`,
    "- Si no localizas el elemento con confianza o el cambio es ambiguo, no adivines: deja una nota con `edit` (conservando el texto original) y pide la decisión a la persona.",
    "",
    "## 3. Resolver (por cada comentario, en orden)",
    `1. \`${cli} claim <id> [--expect-updated-at <updatedAt>]\`  pending -> in_progress.`,
    "2. Implementa el cambio en el código del proyecto.",
    "3. Verifica (build, typecheck, lint, tests o inspección visual en la URL del proyecto, segun corresponda).",
    `4. \`${cli} resolve <id> --summary "qué cambiaste y por que" --files a.tsx,b.css --verification "como lo verificaste" --by agent [--commit sha] [--expect-updated-at <updatedAt>]\``,
    `- Otros: \`status <id> pending|in_progress|ignored|archived\`, \`ignore <id>\` (solo si la persona lo indico o ya no aplica; explica por que), \`reopen <id>\`, \`edit <id> --comment "..."\`, \`move <id...> --to <coleccion>\`, \`export --format md [--out archivo.md]\`.`,
    "- Bloqueo optimista: `--expect-updated-at <iso>` (alias `--rev`) con el `updatedAt` que leiste; si el comentario cambio, falla sin tocar nada.",
    "- Códigos de salida: 0 ok, 2 uso/validacion, 3 proyecto o .perfect-front no encontrado, 6 id no encontrado, 7 conflicto (revisión obsoleta `stale_revisión` o transición no permitida: vuelve a leer con `show` y decide de nuevo), 8 datos ilegibles/almacenamiento.",
    "",
    "## Al terminar",
    "Entrega un resumen: por comentario, su id, qué cambiaste (archivos) y como lo verificaste; y lista aparte los que dejaste abiertos y por que. No toques comentarios ajenos al grupo o a la lista que te pidieron.",
  );
  return L.join("\n");
}

/** Nombre del archivo (dentro de .perfect-front) donde se guarda el prompt completo. */
export const AGENT_PROMPT_FILE = "AGENT_PROMPT.md";

/** Prompt corto para imprimir en terminal: qué hacer, dónde están los comentarios y dónde está el prompt completo. */
export function buildShortAgentPrompt(ctx: AgentPromptContext, promptFile: string): string {
  const cli = ctx.cli ?? "perfect-front";
  const root = path.resolve(ctx.root);
  const pf = path.join(root, ".perfect-front");
  return [
    "Aplica en el código de este proyecto los comentarios visuales de Perfect Front, uno por uno, y ve moviéndolos EN VIVO para que la persona vea el avance en el widget:",
    `1. \`${cli} claim <id>\` al empezar (pending → in_progress).`,
    "2. Implementa el cambio y verifícalo.",
    `3. \`${cli} resolve <id> --summary "qué cambiaste" --files a,b --by agent\` apenas termines ese comentario (no los dejes para el final).`,
    "",
    `- Comentarios (un JSON por comentario): ${path.join(pf, "comments", "<coleccion>", "<id>.json")}  →  ${path.join(pf, "comments")}`,
    `- Capturas adjuntas: ${path.join(pf, "attachments")}`,
    `- Pendientes: \`${cli} list --json\` (desde ${root} o con --cwd "${root}")`,
    `- Instrucciones completas (léelas antes de empezar): ${promptFile}`,
    `- No edites ${pf} a mano: usa solo los comandos de la CLI.`,
  ].join("\n");
}

export interface InboxPromptInfo {
  /** IDs de los comentarios de la petición, en el orden en que deben atenderse. */
  ids: string[];
  /** Grupo de lectura de la petición, si se envió un grupo. */
  groupId?: string | null;
  /** Identificación del agente destino que dio la persona (id o JSON). */
  agentRef?: string;
}

/**
 * Prompt de una petición del widget: el prompt general + QUÉ hay pendiente (conteo, ids, grupo/orden).
 * Regla dura: nunca incluye texto de comentarios, HTML, imágenes ni token; el agente lo lee con la CLI.
 */
export function buildInboxPrompt(ctx: AgentPromptContext, info: InboxPromptInfo): string {
  const cli = ctx.cli ?? "perfect-front";
  const extra = [
    "",
    "## Petición enviada desde el widget",
    ...(info.agentRef ? [`Destinatario: ${info.agentRef}`] : []),
    `Pendientes: ${info.ids.length} → ${info.ids.length > 0 ? info.ids.join(", ") : "(ninguno)"}`,
    ...(info.groupId ? [`Grupo: ${info.groupId} (ids en el orden de cola del grupo; la nota está en groups.json)`] : []),
    `Lee cada uno con \`${cli} show <id> --json\` (o \`${cli} list --json\`) y sigue el flujo claim → resolve de arriba, solo para estos ids.`,
  ];
  return buildAgentPrompt(ctx) + "\n" + extra.join("\n");
}
