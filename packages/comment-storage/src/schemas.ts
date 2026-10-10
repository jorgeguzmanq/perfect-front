// Los contratos viven en @perfect-front/shared; aquí solo se reexportan los que usa el almacenamiento.
import { PerfectFrontError } from "@perfect-front/shared";

export {
  CollectionNameSchema,
  CommentIdSchema,
  CreateCommentRequestSchema,
  ListCommentsQuerySchema,
  MoveCommentRequestSchema,
  ProjectConfigSchema,
  ResolveCommentRequestSchema,
  UpdateCommentRequestSchema,
  VisualCommentSchema,
  migrateComment,
  migrateProjectConfig,
} from "@perfect-front/shared";

export type {
  CollectionInfo,
  CreateCommentRequest,
  ListCommentsQuery,
  ProjectConfig,
  ResolveCommentRequest,
  UpdateCommentRequest,
  VisualComment,
} from "@perfect-front/shared";

export type ScreenshotMime = "image/png" | "image/jpeg" | "image/webp";

const EXT: Record<ScreenshotMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((v, i) => b[offset + i] === v);
}

/** Decodifica y verifica magic bytes (el MIME declarado no se acepta a ciegas). */
export function decodeScreenshot(
  mimeType: ScreenshotMime,
  dataBase64: string,
  maxBytes: number,
): { bytes: Uint8Array; ext: string } {
  if (dataBase64.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw new PerfectFrontError("payload_too_large", "Captura demasiado grande");
  }
  const bytes = new Uint8Array(Buffer.from(dataBase64, "base64"));
  if (bytes.byteLength === 0) throw new PerfectFrontError("invalid_request", "Captura vacía");
  if (bytes.byteLength > maxBytes) throw new PerfectFrontError("payload_too_large", "Captura demasiado grande");
  const ok =
    (mimeType === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    (mimeType === "image/webp" && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8));
  if (!ok) throw new PerfectFrontError("invalid_request", "El contenido de la captura no coincide con su tipo");
  return { bytes, ext: EXT[mimeType] };
}
