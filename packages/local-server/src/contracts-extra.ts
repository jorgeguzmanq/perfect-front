import { z } from "zod";
import { CommentIdSchema, MoveCommentRequestSchema, VisualCommentSchema } from "@perfect-front/shared";
import { LIMITS } from "./config";

/** Movimiento por lote (SPEC §7); no existe en shared. Propuesta para promoverlo allí. */
export const BatchMoveRequestSchema = z
  .object({
    ids: z.array(CommentIdSchema).min(1).max(LIMITS.maxBatchIds),
    to: MoveCommentRequestSchema.shape.to,
  })
  .strict();
export type BatchMoveRequest = z.infer<typeof BatchMoveRequestSchema>;

export const BatchMoveResponseSchema = z
  .object({
    ok: z.literal(true),
    results: z.array(
      z.discriminatedUnion("ok", [
        z.object({ id: z.string(), ok: z.literal(true), comment: VisualCommentSchema }).strict(),
        z
          .object({ id: z.string(), ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }).strict() })
          .strict(),
      ]),
    ),
  })
  .strict();
export type BatchMoveResponse = z.infer<typeof BatchMoveResponseSchema>;

/** Respuesta de acciones de proceso (start/stop). */
export const ProcessActionResponseSchema = z
  .object({
    ok: z.literal(true),
    project: z.unknown(),
    outcome: z.enum(["started", "connected", "stopped", "external", "none"]),
  })
  .strict();

export const LogsQuerySchema = z
  .object({ lines: z.coerce.number().int().min(1).max(LIMITS.maxLogLines).optional() })
  .strict();
