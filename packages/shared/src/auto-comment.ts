import { LIMITS } from "./limits";
import type { CommentProposal } from "./comment";

/**
 * Comentario autogenerado a partir de propuestas (SPEC §6.3): cuando la persona edita texto, estilos u orden
 * directo en el widget, ese cambio ES el comentario. Una línea por propuesta, agrupadas por sección.
 */

const cut = (t: string, max = 80): string => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const q = (t: string | null): string => `«${cut(t ?? "")}»`;

function lineFor(p: CommentProposal): string {
  switch (p.kind) {
    case "text_fixed":
    case "text_dynamic":
      return `Cambiar texto de ${q(p.before)} a ${q(p.after)}`;
    case "text_i18n": {
      const key = p.scope === "one" && p.newKey ? p.newKey : p.key;
      const changes = p.locales.map((l) => `[${l.locale}] ${q(l.before)} → ${q(l.after)}`).join("; ");
      return `Cambiar texto (clave ${key}): ${changes}`;
    }
    case "style":
      return `Cambiar estilo: ${p.changes.map((c) => `${c.property} ${cut(c.before, 40) || "(vacío)"} → ${cut(c.after, 40) || "(vacío)"}`).join(", ")}`;
    case "reorder":
      return `Reordenar: ${p.targetSelector ?? "el elemento"} pasa de la posición ${p.from} a la ${p.to}`;
  }
}

const SECTIONS: Array<{ title: string; kinds: ReadonlyArray<CommentProposal["kind"]> }> = [
  { title: "Texto", kinds: ["text_fixed", "text_dynamic", "text_i18n"] },
  { title: "Estilos", kinds: ["style"] },
  { title: "Orden", kinds: ["reorder"] },
];

/** Texto del comentario para las propuestas dadas; "" si no hay ninguna. */
export function proposalsToComment(proposals: readonly CommentProposal[]): string {
  const blocks = SECTIONS.map((s) => ({ title: s.title, lines: proposals.filter((p) => s.kinds.includes(p.kind)).map(lineFor) })).filter((b) => b.lines.length > 0);
  if (blocks.length === 0) return "";
  const total = blocks.reduce((n, b) => n + b.lines.length, 0);
  const text = total === 1 ? blocks[0]!.lines[0]! : blocks.map((b) => `${b.title}:\n${b.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  return text.slice(0, LIMITS.comment);
}

/** Antepone la nota de la persona (si hay) al texto generado; no lo duplica si la nota ya lo contiene. */
export function composeWithAuto(note: string, auto: string): string {
  const n = note.trim();
  if (!auto) return n;
  if (!n) return auto;
  return (n.includes(auto) ? n : `${n}\n\n${auto}`).slice(0, LIMITS.comment);
}
