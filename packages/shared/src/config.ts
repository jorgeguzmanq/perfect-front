import { z } from "zod";
import { CollectionNameSchema } from "./ids";

export const CONFIG_VERSION = 1 as const;

/** Ruta relativa segura (separador `/`, sin `..`, sin absolutas) a una página .html del proyecto. */
export function isSafeHtmlEntry(v: string): boolean {
  if (v.includes("\0") || v.includes("\\") || v.startsWith("/") || /^[A-Za-z]:/.test(v)) return false;
  if (!/\.html$/i.test(v)) return false;
  return v.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export const ProjectConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    name: z.string().min(1).max(120).optional(),
    command: z.string().min(1).max(500).optional(),
    url: z
      .string()
      .max(2048)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "URL debe ser http(s)")
      .optional(),
    defaultCollection: CollectionNameSchema.optional(),
    resolvedCollection: CollectionNameSchema.optional(),
    captureScreenshots: z.boolean().optional(),
    openBrowser: z.boolean().optional(),
    /** Página .html elegida para proyectos estáticos (ruta relativa con `/`). */
    entry: z.string().min(1).max(260).refine(isSafeHtmlEntry, "entry debe ser una ruta relativa .html sin '..'").optional(),
  })
  .strict();
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
