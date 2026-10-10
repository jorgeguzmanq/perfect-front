import { z } from "zod";

export const ERROR_CODES = [
  "invalid_request",
  "invalid_id",
  "invalid_collection",
  "unauthorized",
  "forbidden_origin",
  "not_found",
  "conflict",
  "payload_too_large",
  "unsupported_version",
  "invalid_data",
  "storage_error",
  "process_error",
  "internal_error",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Error serializable: `message` es seguro para mostrar (sin rutas ni trazas). */
export const PerfectFrontErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().min(1).max(500),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }).strict())
      .max(50)
      .optional(),
  })
  .strict();
export type PerfectFrontErrorData = z.infer<typeof PerfectFrontErrorSchema>;

export const ErrorResponseSchema = z.object({ ok: z.literal(false), error: PerfectFrontErrorSchema }).strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export class PerfectFrontError extends Error {
  readonly code: ErrorCode;
  readonly details: PerfectFrontErrorData["details"];
  constructor(code: ErrorCode, message: string, details?: PerfectFrontErrorData["details"]) {
    super(message);
    this.name = "PerfectFrontError";
    this.code = code;
    this.details = details;
  }
  toJSON(): PerfectFrontErrorData {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

/** Convierte un ZodError en detalles seguros (sin valores recibidos). */
export function zodDetails(error: z.ZodError): NonNullable<PerfectFrontErrorData["details"]> {
  return error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Convierte cualquier valor lanzado en un error serializable seguro. */
export function toErrorData(err: unknown): PerfectFrontErrorData {
  if (err instanceof PerfectFrontError) return err.toJSON();
  if (err instanceof z.ZodError) {
    return { code: "invalid_request", message: "Datos inválidos", details: zodDetails(err) };
  }
  return { code: "internal_error", message: "Error interno" };
}
