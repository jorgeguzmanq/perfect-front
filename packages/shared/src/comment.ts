import { z } from "zod";
import { AttachmentPathSchema, CollectionNameSchema, CommentIdSchema } from "./ids";
import { TimestampSchema } from "./timestamps";

export const COMMENT_VERSION = 1 as const;

export const COMMENT_STATUSES = ["pending", "in_progress", "resolved", "ignored", "archived"] as const;
export const CommentStatusSchema = z.enum(COMMENT_STATUSES);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const COMMENT_SCOPES = ["element", "view"] as const;
export const CommentScopeSchema = z.enum(COMMENT_SCOPES);
export type CommentScope = z.infer<typeof CommentScopeSchema>;

/** Límites de tamaño (SPEC §15.10). */
export const LIMITS = {
  comment: 10_000,
  html: 20_000,
  text: 2_000,
  selector: 1_000,
  selectorCandidates: 20,
} as const;

// eslint-disable-next-line no-control-regex -- rechazar caracteres de control es el objetivo
const CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]");
const noControl = (v: string) => !CONTROL_RE.test(v);
const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "URL debe ser http(s)");
const finite = z.number().finite();

export const CommentTextSchema = z.string().min(1).max(LIMITS.comment);

export const CommentProjectSchema = z
  .object({
    name: z.string().min(1).max(120),
    relativeRoot: z.literal("."),
  })
  .strict();

export const CommentLocationSchema = z
  .object({
    url: httpUrl,
    route: z.string().max(2048).startsWith("/").refine(noControl, "route con caracteres de control"),
    title: z.string().max(500).nullable(),
    selector: z.string().min(1).max(LIMITS.selector).nullable(),
    selectorCandidates: z.array(z.string().min(1).max(LIMITS.selector)).max(LIMITS.selectorCandidates),
    text: z.string().max(LIMITS.text).nullable(),
    html: z.string().max(LIMITS.html).nullable(),
    componentHint: z.string().max(200).nullable(),
  })
  .strict();

export const ViewportSchema = z
  .object({
    width: finite.positive(),
    height: finite.positive(),
    devicePixelRatio: finite.positive(),
    scrollX: finite,
    scrollY: finite,
  })
  .strict();

export const ElementRectSchema = z
  .object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative() })
  .strict();

export const EnvironmentSchema = z
  .object({
    framework: z.string().max(80).nullable().optional(),
    browser: z.string().max(80).nullable().optional(),
    colorScheme: z.enum(["light", "dark"]).nullable().optional(),
  })
  .strict();

export const ResolutionSchema = z
  .object({
    resolvedAt: TimestampSchema,
    resolvedBy: z.string().max(120).nullable().optional(),
    summary: z.string().min(1).max(5_000),
    filesChanged: z.array(z.string().min(1).max(500)).max(500),
    verification: z.array(z.string().max(1_000)).max(100),
    commit: z.string().max(80).nullable(),
  })
  .strict();
export type Resolution = z.infer<typeof ResolutionSchema>;

export const VisualCommentSchema = z
  .object({
    version: z.literal(COMMENT_VERSION),
    id: CommentIdSchema,
    status: CommentStatusSchema,
    collection: CollectionNameSchema,
    scope: CommentScopeSchema,
    comment: CommentTextSchema,
    project: CommentProjectSchema,
    location: CommentLocationSchema,
    viewport: ViewportSchema,
    elementRect: ElementRectSchema.nullable(),
    environment: EnvironmentSchema,
    attachments: z.array(AttachmentPathSchema).max(20),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    resolution: ResolutionSchema.nullable(),
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
    if (c.resolution && c.status !== "resolved" && c.status !== "archived") {
      ctx.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "resolution solo con status resolved o archived",
      });
    }
  });
export type VisualComment = z.infer<typeof VisualCommentSchema>;
