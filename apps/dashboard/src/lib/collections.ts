import { CollectionNameSchema } from "@perfect-front/shared";

export type CollectionValidation = { ok: true; name: string } | { ok: false; message: string };

/**
 * Valida un nombre de coleccion con el MISMO esquema que el servidor (shared) y rechaza duplicados.
 * El nombre se normaliza a minusculas sin espacios laterales antes de validar.
 */
export function validateCollectionName(input: string, existing: readonly string[]): CollectionValidation {
  const name = input.trim().toLowerCase();
  if (name === "") return { ok: false, message: "Escribe un nombre." };
  if (name.length > 64) return { ok: false, message: "Máximo 64 caracteres." };
  const parsed = CollectionNameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, message: "Usa solo minúsculas, números, guiones y guion bajo; debe empezar por letra o número." };
  }
  if (existing.some((e) => e.toLowerCase() === name)) return { ok: false, message: "Ya existe una colección con ese nombre." };
  return { ok: true, name };
}
