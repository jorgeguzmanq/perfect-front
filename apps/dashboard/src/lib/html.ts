const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapa HTML para contextos de texto/atributo. La UI usa nodos de texto de React; esto cubre salidas textuales. */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

/** Navegacion solo a http(s): nunca `javascript:`, `data:` ni `file:` aunque el JSON del comentario se haya editado a mano. */
export function safeHttpUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
