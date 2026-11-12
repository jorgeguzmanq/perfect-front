import type { VisualComment } from "@perfect-front/shared";

/** Valor en línea seguro: sin saltos ni backticks que rompan el código en línea. */
function inline(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ").replace(/`/g, "'");
  return "`" + flat + "`";
}

/** Bloque de código con una valla más larga que cualquier racha de backticks interna. */
function fenced(text: string, lang = ""): string {
  let longest = 2;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

function renderComment(c: VisualComment): string {
  const lines: string[] = [];
  lines.push(`### ${c.id}`);
  lines.push("");
  lines.push(`- Estado: ${inline(c.status)}`);
  lines.push(`- Colección: ${inline(c.collection)}`);
  lines.push(`- Alcance: ${inline(c.scope)}`);
  lines.push(`- Ruta: ${inline(c.location.route)}`);
  lines.push(`- URL: ${inline(c.location.url)}`);
  if (c.location.selector) lines.push(`- Selector: ${inline(c.location.selector)}`);
  lines.push(`- Viewport: ${inline(`${c.viewport.width}x${c.viewport.height}`)}`);
  lines.push(`- Creado: ${inline(c.createdAt)}`);
  lines.push(`- Actualizado: ${inline(c.updatedAt)}`);
  for (const a of c.attachments) lines.push(`- Adjunto: ${inline(a)}`);
  lines.push("");
  lines.push(quote(c.comment));
  if (c.location.text) {
    lines.push("");
    lines.push("Texto del elemento:");
    lines.push("");
    lines.push(fenced(c.location.text));
  }
  if (c.location.html) {
    lines.push("");
    lines.push("HTML (solo como código):");
    lines.push("");
    lines.push(fenced(c.location.html, "html"));
  }
  if (c.resolution) {
    const r = c.resolution;
    lines.push("");
    lines.push(`**Resolución** (${inline(r.resolvedAt)}${r.resolvedBy ? ` por ${inline(r.resolvedBy)}` : ""})`);
    lines.push("");
    lines.push(quote(r.summary));
    if (r.filesChanged.length) lines.push("", "Archivos: " + r.filesChanged.map(inline).join(", "));
    if (r.verification.length) lines.push("", "Verificación: " + r.verification.map(inline).join(", "));
    if (r.commit) lines.push("", `Commit: ${inline(r.commit)}`);
  }
  return lines.join("\n");
}

/** Renderiza un reporte Markdown. Función pura: no toca el filesystem. */
export function renderMarkdown(
  comments: readonly VisualComment[],
  opts: { title?: string; generatedAt: string; collection?: string },
): string {
  const out: string[] = [];
  out.push(`# ${opts.title ?? "Comentarios de Perfect Front"}`);
  out.push("");
  out.push(`Generado: ${inline(opts.generatedAt)}${opts.collection ? ` · Colección: ${inline(opts.collection)}` : ""}`);
  out.push(`Total: ${comments.length}`);
  const byCollection = new Map<string, VisualComment[]>();
  for (const c of comments) {
    const list = byCollection.get(c.collection) ?? [];
    list.push(c);
    byCollection.set(c.collection, list);
  }
  for (const name of [...byCollection.keys()].sort()) {
    const list = byCollection.get(name)!;
    out.push("", `## ${name} (${list.length})`);
    for (const c of list) out.push("", renderComment(c));
  }
  return out.join("\n") + "\n";
}
