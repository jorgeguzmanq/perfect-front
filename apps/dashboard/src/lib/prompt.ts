import type { VisualComment } from "@perfect-front/shared";

/** Delimitador mas largo que cualquier racha de comillas invertidas del contenido (evita romper el bloque). */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(longest + 1);
}

/**
 * Texto listo para pegar en Claude Code. Solo referencia los comandos `perfect-front show/resolve`
 * (los implementa el CLI). No incluye el HTML capturado: el agente lo obtiene con `show --json`.
 */
export function buildAgentPrompt(comment: VisualComment, projectName?: string): string {
  const { location: loc } = comment;
  const f = fence(comment.comment);
  const lines: string[] = [
    "Atiende este comentario visual de Perfect Front y deja el cambio hecho en el codigo del proyecto.",
    "",
    ...(projectName ? [`Proyecto: ${projectName}`] : []),
    `ID: ${comment.id}`,
    `Estado: ${comment.status} (coleccion ${comment.collection})`,
    `Ruta: ${loc.route}`,
    `URL: ${loc.url}`,
  ];
  if (loc.title) lines.push(`Titulo: ${loc.title}`);
  if (loc.selector) lines.push(`Selector: ${loc.selector}`);
  if (loc.selectorCandidates.length > 0) {
    lines.push("Selectores candidatos:", ...loc.selectorCandidates.map((s) => `- ${s}`));
  }
  if (loc.componentHint) lines.push(`Componente (pista): ${loc.componentHint}`);
  lines.push("", "Comentario:", f, comment.comment, f, "");
  lines.push(
    "Pasos:",
    `1. Lee el contexto completo: perfect-front show ${comment.id} --json`,
    "2. Localiza el elemento (selectores y texto) en el codigo fuente y aplica el cambio pedido.",
    "3. Verifica el resultado (build/tests o revision visual en la ruta indicada).",
    `4. Marca el comentario como resuelto: perfect-front resolve ${comment.id} ... (resumen, archivos cambiados y verificacion; ver perfect-front resolve --help)`,
  );
  return lines.join("\n");
}
