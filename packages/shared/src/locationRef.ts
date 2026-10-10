import { z } from "zod";
import type { LocationSource } from "./comment";

/** Formatos de «copiar ubicación» (SPEC §13.5). */
export const LOCATION_REF_FORMATS = ["file", "selector", "pf", "markdown"] as const;
export const LocationRefFormatSchema = z.enum(LOCATION_REF_FORMATS);
export type LocationRefFormat = z.infer<typeof LocationRefFormatSchema>;

export interface LocationRefInput {
  route: string;
  selector: string | null;
  source: LocationSource | null | undefined;
  /** Etiqueta corta del elemento, p. ej. `button.cta`. */
  label?: string | null;
}

/** Texto a copiar para un nodo; null si no hay dato para ese formato. Función pura. */
export function formatLocationRef(format: LocationRefFormat, ref: LocationRefInput): string | null {
  const file = ref.source ? `${ref.source.file}${ref.source.line ? `:${ref.source.line}` : ""}` : null;
  switch (format) {
    case "file":
      return file;
    case "selector":
      return ref.selector;
    case "pf":
      return ref.selector ? `pf://${ref.route.replace(/^\//, "")}#${ref.selector.split(" > ").pop()}` : null;
    case "markdown": {
      const parts = [file, ref.label ?? ref.selector].filter((p): p is string => !!p).map((p) => `\`${p.replace(/`/g, "'")}\``);
      return parts.length ? `${parts.join(" · ")} en ${ref.route}` : null;
    }
  }
}
