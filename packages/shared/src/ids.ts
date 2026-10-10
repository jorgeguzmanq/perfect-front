import { z } from "zod";

/** Nombres reservados de dispositivo en Windows (con o sin extensión). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED.test(name);
}

/** Segmento seguro como nombre de archivo/carpeta en cualquier SO. */
function safeSegment(label: string, pattern: RegExp, max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .regex(pattern, `${label} contiene caracteres no permitidos`)
    .refine((v) => !isWindowsReservedName(v), `${label} usa un nombre reservado`);
}

const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COLLECTION_RE = /^[a-z0-9][a-z0-9_-]*$/;
/** pf_ + Crockford base32 en mayúsculas (ordenable lexicográficamente). */
const COMMENT_ID_RE = /^pf_[0-9A-HJKMNP-TV-Z]{5,40}$/;

export const ProjectIdSchema = safeSegment("ProjectId", PROJECT_ID_RE, 64).brand<"ProjectId">();
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const CommentIdSchema = z
  .string()
  .regex(COMMENT_ID_RE, "CommentId inválido")
  .brand<"CommentId">();
export type CommentId = z.infer<typeof CommentIdSchema>;

export const CollectionNameSchema = safeSegment("CollectionName", COLLECTION_RE, 64).brand<"CollectionName">();
export type CollectionName = z.infer<typeof CollectionNameSchema>;

export const DEFAULT_COLLECTIONS = ["inbox", "resolved", "archived"] as const;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ID ordenable por tiempo: pf_ + 10 chars de tiempo (ms) + 16 aleatorios. */
export function generateCommentId(now: number = Date.now(), randomBytes?: Uint8Array): CommentId {
  let t = Math.floor(now);
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[(bytes[i] ?? 0) % 32]!;
  return CommentIdSchema.parse(`pf_${time}${rand}`);
}

/** Ruta relativa de adjunto: attachments/<archivo>. */
export const AttachmentPathSchema = z
  .string()
  .max(200)
  .regex(/^attachments\/[A-Za-z0-9][A-Za-z0-9._-]*$/, "Ruta de adjunto inválida")
  .refine(
    (v) => !v.includes("..") && !isWindowsReservedName(v.slice("attachments/".length)),
    "Ruta de adjunto insegura",
  );
