export const OVERLAY_PATH = "/__pf/overlay.js";

export function buildSnippet(token: string): string {
  return `<script src="${OVERLAY_PATH}" data-pf-token="${token}" data-pf-base="/__pf" defer></script>`;
}

/**
 * Inserta `snippet` antes de `</head>`; si no hay, antes de `</body>`; si no, al inicio.
 * Idempotente: si el HTML ya referencia el overlay se devuelve intacto.
 */
export function injectSnippet(html: string, snippet: string): string {
  if (html.includes(OVERLAY_PATH)) return html;
  const line = `  ${snippet}\n`;
  for (const re of [/<\/head\s*>/i, /<\/body\s*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index) + line + html.slice(m.index);
  }
  return snippet + html;
}
