import { z } from "zod";
import {
  AttachmentSourceSchema,
  COMMENT_VERSION,
  COMMENT_VERSION_V1,
  CommentGroupRefSchema,
  CommentProposalSchema,
  CommentSectionSchema,
  ExtraTargetSchema,
  LIMITS,
  ReadingGroupSchema,
  refineV2Parts,
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
import { proposalsToComment } from "./auto-comment";
import { CollectionNameSchema, CommentIdSchema, GroupIdSchema, LocalIdSchema, ProjectIdSchema } from "./ids";

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

export type ScreenshotUpload = z.infer<typeof ScreenshotUploadSchema>;

/**
 * Imagen nueva (pegada, soltada, abierta o capturada). El servidor la guarda en attachments/ y la ata a
 * `sectionId` (null = suelta, sin sección). `clientId` solo identifica la subida dentro de la request.
 */
export const AttachmentUploadSchema = ScreenshotUploadSchema.extend({
  clientId: LocalIdSchema,
  name: z.string().min(1).max(LIMITS.attachmentName),
  source: AttachmentSourceSchema,
  sectionId: LocalIdSchema.nullable(),
}).strict();
export type AttachmentUpload = z.infer<typeof AttachmentUploadSchema>;

/** Sección en una request de creación: las imágenes se declaran en `uploads` con `sectionId`. */
export const NewSectionSchema = CommentSectionSchema.omit({ attachments: true });
export type NewSection = z.infer<typeof NewSectionSchema>;

const uploadsArray = z.array(AttachmentUploadSchema).max(LIMITS.attachments);

function refineUploads(
  c: { uploads: AttachmentUpload[]; sections?: { id: string }[]; screenshot?: unknown },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  let chars = 0;
  c.uploads.forEach((u, i) => {
    if (ids.has(u.clientId)) ctx.addIssue({ code: "custom", path: ["uploads", i, "clientId"], message: "clientId duplicado" });
    ids.add(u.clientId);
    chars += u.dataBase64.length;
    if (c.sections && u.sectionId !== null && !c.sections.some((s) => s.id === u.sectionId)) {
      ctx.addIssue({ code: "custom", path: ["uploads", i, "sectionId"], message: "sectionId inexistente" });
    }
  });
  if (c.uploads.length + (c.screenshot ? 1 : 0) > LIMITS.attachments) {
    ctx.addIssue({ code: "custom", path: ["uploads"], message: `máximo ${LIMITS.attachments} adjuntos por comentario` });
  }
  if (chars > LIMITS.uploadsBase64) ctx.addIssue({ code: "custom", path: ["uploads"], message: "subidas demasiado grandes" });
}

/** Acepta clientes v1 (sin campos nuevos) y v2. */
export const CreateCommentRequestSchema = z
  .object({
    version: z.union([z.literal(COMMENT_VERSION_V1), z.literal(COMMENT_VERSION)]),
    collection: CollectionNameSchema.optional(),
    scope: CommentScopeSchema,
    /** Puede venir vacío si hay propuestas: entonces se autogenera (SPEC §6.3). */
    comment: z.string().max(LIMITS.comment),
    location: CommentLocationSchema,
    viewport: ViewportSchema,
    elementRect: ElementRectSchema.nullable(),
    environment: EnvironmentSchema,
    /** Heredado de v1: una captura, tratada como imagen `capture` suelta. */
    screenshot: ScreenshotUploadSchema.optional(),
    sections: z.array(NewSectionSchema).max(LIMITS.sections).default([]),
    uploads: uploadsArray.default([]),
    extraTargets: z.array(ExtraTargetSchema).max(LIMITS.extraTargets).default([]),
    proposals: z.array(CommentProposalSchema).max(LIMITS.proposals).default([]),
    group: CommentGroupRefSchema.nullable().default(null),
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
    if (c.comment.trim().length === 0 && c.proposals.length === 0) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "comment vacío sin propuestas" });
    }
    refineUploads(c, ctx);
    refineV2Parts(
      {
        scope: c.scope,
        attachments: [],
        attachmentInfo: [],
        sections: c.sections.map((s) => ({ ...s, attachments: [] })),
        extraTargets: c.extraTargets,
        proposals: c.proposals,
      },
      ctx,
    );
  })
  .transform((c) => (c.comment.trim() ? c : { ...c, comment: proposalsToComment(c.proposals) }));
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;

export const ListCommentsQuerySchema = z
  .object({
    collection: CollectionNameSchema.optional(),
    status: CommentStatusSchema.optional(),
    q: z.string().max(200).optional(),
  })
  .strict();
export type ListCommentsQuery = z.infer<typeof ListCommentsQuerySchema>;

/**
 * PATCH. `sections` reemplaza la lista completa: así se reubican imágenes entre secciones (solo rutas
 * que el comentario ya tiene; las de `uploads` se atan por `sectionId`). Una ruta ausente de todas las
 * secciones queda suelta; los archivos nunca se borran por PATCH.
 */
export const UpdateCommentRequestSchema = z
  .object({
    comment: CommentTextSchema.optional(),
    status: CommentStatusSchema.optional(),
    sections: z.array(CommentSectionSchema).max(LIMITS.sections).optional(),
    uploads: uploadsArray.optional(),
    extraTargets: z.array(ExtraTargetSchema).max(LIMITS.extraTargets).optional(),
    proposals: z.array(CommentProposalSchema).max(LIMITS.proposals).optional(),
    group: CommentGroupRefSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH vacío")
  .superRefine((c, ctx) => {
    if (c.uploads) refineUploads({ uploads: c.uploads, ...(c.sections ? { sections: c.sections } : {}) }, ctx);
  });
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


// --- Grupos de lectura ---------------------------------------------------------

export const CreateGroupRequestSchema = z
  .object({
    id: GroupIdSchema.optional(),
    name: ReadingGroupSchema.shape.name,
    note: ReadingGroupSchema.shape.note.default(""),
    readFirst: ReadingGroupSchema.shape.readFirst.default(true),
  })
  .strict();
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const UpdateGroupRequestSchema = z
  .object({
    name: ReadingGroupSchema.shape.name.optional(),
    note: ReadingGroupSchema.shape.note.optional(),
    readFirst: ReadingGroupSchema.shape.readFirst.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH vacío");
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

/** Orden de la cola: `order[i]` pasa a `position = i + 1`; los ausentes salen del grupo. */
export const ReorderGroupRequestSchema = z
  .object({ order: z.array(CommentIdSchema).max(LIMITS.groupItems) })
  .strict()
  .refine((v) => new Set(v.order).size === v.order.length, "ids duplicados");
export type ReorderGroupRequest = z.infer<typeof ReorderGroupRequestSchema>;

// --- Peticiones al agente (buzón) ------------------------------------------------

/** El widget solo envía IDs: ninguno = toda la cola pendiente; `groupId` = la cola de ese grupo. */
export const CreateAgentRequestSchema = z
  .object({
    commentIds: z.array(CommentIdSchema).min(1).max(LIMITS.groupItems).optional(),
    groupId: GroupIdSchema.optional(),
    /** ID (o JSON de identificación) que el agente destino le dio a la persona; se guarda con la solicitud. */
    agentRef: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const ListGroupsResponseSchema = z
  .object({ ok: z.literal(true), groups: z.array(ReadingGroupSchema) })
  .strict();
export type ListGroupsResponse = z.infer<typeof ListGroupsResponseSchema>;

export const GroupResponseSchema = z.object({ ok: z.literal(true), group: ReadingGroupSchema }).strict();
export type GroupResponse = z.infer<typeof GroupResponseSchema>;
