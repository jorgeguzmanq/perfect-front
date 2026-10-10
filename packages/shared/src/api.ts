import { z } from "zod";
import {
  COMMENT_VERSION,
  CommentLocationSchema,
  CommentScopeSchema,
  CommentTextSchema,
  CommentStatusSchema,
  ElementRectSchema,
  EnvironmentSchema,
  ResolutionSchema,
  ViewportSchema,
  VisualCommentSchema,
} from "./comment";
import { ProjectConfigSchema } from "./config";
import { CollectionNameSchema, ProjectIdSchema } from "./ids";

/** Todas las requests son .strict(): ninguna acepta rutas de filesystem (SPEC §12). */

// --- Proyectos ---------------------------------------------------------------

export const PROCESS_STATES = ["stopped", "starting", "running", "failed", "external"] as const;
export const ProcessStateSchema = z.enum(PROCESS_STATES);
export type ProcessState = z.infer<typeof ProcessStateSchema>;

export const ProjectSummarySchema = z
  .object({
    id: ProjectIdSchema,
    name: z.string().min(1).max(120),
    /** URL que se abre para revisar: la del proxy con la capa inyectada. */
    url: z.string().max(2048).nullable(),
    /** URL original del dev server o servidor estático detrás del proxy (null si no hay proxy). */
    targetUrl: z.string().max(2048).nullable().optional(),
    framework: z.string().max(80).nullable(),
    processState: ProcessStateSchema,
    managed: z.boolean(),
    pendingCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** Única request que transporta una raíz: la envía el CLI local, nunca el overlay. */
export const RegisterProjectRequestSchema = z
  .object({
    root: z.string().min(1).max(1024),
    url: z.string().max(2048).url().optional(),
    targetUrl: z.string().max(2048).url().optional(),
    config: ProjectConfigSchema.optional(),
  })
  .strict();
export type RegisterProjectRequest = z.infer<typeof RegisterProjectRequestSchema>;

export const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    version: z.string().max(50),
    apiVersion: z.literal(1),
    /** Capacidades del servidor (p. ej. "proxy-v1"); el CLI las usa para detectar un servidor desactualizado. */
    features: z.array(z.string().max(50)).max(32).optional(),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ListProjectsResponseSchema = z
  .object({ ok: z.literal(true), projects: z.array(ProjectSummarySchema) })
  .strict();
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>;

export const RegisterProjectResponseSchema = z
  .object({ ok: z.literal(true), project: ProjectSummarySchema })
  .strict();
export type RegisterProjectResponse = z.infer<typeof RegisterProjectResponseSchema>;

export const ProjectLogsResponseSchema = z
  .object({ ok: z.literal(true), lines: z.array(z.string().max(2000)).max(1000) })
  .strict();
export type ProjectLogsResponse = z.infer<typeof ProjectLogsResponseSchema>;

// --- Comentarios -------------------------------------------------------------

export const ScreenshotUploadSchema = z
  .object({
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: z.string().max(10_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64 inválido"),
  })
  .strict();

export const CreateCommentRequestSchema = z
  .object({
    version: z.literal(COMMENT_VERSION),
    collection: CollectionNameSchema.optional(),
    scope: CommentScopeSchema,
    comment: CommentTextSchema,
    location: CommentLocationSchema,
    viewport: ViewportSchema,
    elementRect: ElementRectSchema.nullable(),
    environment: EnvironmentSchema,
    screenshot: ScreenshotUploadSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.scope === "element" && (c.location.selector === null || c.elementRect === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["location", "selector"],
        message: "scope element requiere selector y elementRect",
      });
    }
  });
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const ListCommentsQuerySchema = z
  .object({
    collection: CollectionNameSchema.optional(),
    status: CommentStatusSchema.optional(),
    q: z.string().max(200).optional(),
  })
  .strict();
export type ListCommentsQuery = z.infer<typeof ListCommentsQuerySchema>;

export const UpdateCommentRequestSchema = z
  .object({
    comment: CommentTextSchema.optional(),
    status: CommentStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH vacío");
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>;

export const MoveCommentRequestSchema = z.object({ to: CollectionNameSchema }).strict();
export type MoveCommentRequest = z.infer<typeof MoveCommentRequestSchema>;

export const ResolveCommentRequestSchema = z
  .object({
    resolvedBy: ResolutionSchema.shape.resolvedBy,
    summary: ResolutionSchema.shape.summary,
    filesChanged: ResolutionSchema.shape.filesChanged.optional(),
    verification: ResolutionSchema.shape.verification.optional(),
    commit: ResolutionSchema.shape.commit.optional(),
  })
  .strict();
export type ResolveCommentRequest = z.infer<typeof ResolveCommentRequestSchema>;

export const CommentResponseSchema = z
  .object({ ok: z.literal(true), comment: VisualCommentSchema })
  .strict();
export type CommentResponse = z.infer<typeof CommentResponseSchema>;

export const ListCommentsResponseSchema = z
  .object({ ok: z.literal(true), comments: z.array(VisualCommentSchema) })
  .strict();
export type ListCommentsResponse = z.infer<typeof ListCommentsResponseSchema>;

// --- Colecciones -------------------------------------------------------------

export const CollectionInfoSchema = z
  .object({ name: CollectionNameSchema, count: z.number().int().nonnegative() })
  .strict();
export type CollectionInfo = z.infer<typeof CollectionInfoSchema>;

export const CreateCollectionRequestSchema = z.object({ name: CollectionNameSchema }).strict();
export type CreateCollectionRequest = z.infer<typeof CreateCollectionRequestSchema>;

export const ListCollectionsResponseSchema = z
  .object({ ok: z.literal(true), collections: z.array(CollectionInfoSchema) })
  .strict();
export type ListCollectionsResponse = z.infer<typeof ListCollectionsResponseSchema>;

export const CollectionResponseSchema = z
  .object({ ok: z.literal(true), collection: CollectionInfoSchema })
  .strict();
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;

