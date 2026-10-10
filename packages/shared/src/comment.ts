import { z } from "zod";
import { AttachmentPathSchema, CollectionNameSchema, CommentIdSchema, GroupIdSchema, LocalIdSchema } from "./ids";
import { LIMITS } from "./limits";
import { TimestampSchema } from "./timestamps";

/** v2: secciones, adjuntos con metadatos, propuestas, multiselección y grupo (SPEC §6.3). */
export const COMMENT_VERSION = 2 as const;
export const COMMENT_VERSION_V1 = 1 as const;

export { LIMITS };

export const COMMENT_STATUSES = ["pending", "in_progress", "resolved", "ignored", "archived"] as const;
export const CommentStatusSchema = z.enum(COMMENT_STATUSES);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const COMMENT_SCOPES = ["element", "view"] as const;
export const CommentScopeSchema = z.enum(COMMENT_SCOPES);
export type CommentScope = z.infer<typeof CommentScopeSchema>;

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

/** Origen en el código fuente de un elemento (para «copiar ubicación»). */
export const LocationSourceSchema = z
  .object({
    file: z.string().min(1).max(500),
    line: z.number().int().positive().nullable(),
    column: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type LocationSource = z.infer<typeof LocationSourceSchema>;

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


// --- v2: multiselección ------------------------------------------------------

/** Elemento adicional de una multiselección. El principal sigue en `location`/`elementRect`. */
export const ExtraTargetSchema = z
  .object({
    id: LocalIdSchema,
    selector: z.string().min(1).max(LIMITS.selector),
    selectorCandidates: z.array(z.string().min(1).max(LIMITS.selector)).max(LIMITS.selectorCandidates),
    text: z.string().max(LIMITS.text).nullable(),
    html: z.string().max(LIMITS.extraTargetHtml).nullable(),
    componentHint: z.string().max(200).nullable(),
    source: LocationSourceSchema.nullable().optional(),
    elementRect: ElementRectSchema,
  })
  .strict();
export type ExtraTarget = z.infer<typeof ExtraTargetSchema>;

// --- v2: adjuntos y secciones -------------------------------------------------

export const ATTACHMENT_SOURCES = ["paste", "drop", "open", "capture"] as const;
export const AttachmentSourceSchema = z.enum(ATTACHMENT_SOURCES);
export type AttachmentSource = z.infer<typeof AttachmentSourceSchema>;

export const ATTACHMENT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AttachmentMimeSchema = z.enum(ATTACHMENT_MIME_TYPES);

/** Metadatos de un adjunto. `attachments` sigue siendo la lista canónica de rutas. */
export const AttachmentInfoSchema = z
  .object({
    path: AttachmentPathSchema,
    name: z.string().min(1).max(LIMITS.attachmentName),
    source: AttachmentSourceSchema,
    mimeType: AttachmentMimeSchema,
    bytes: z.number().int().nonnegative(),
  })
  .strict();
export type AttachmentInfo = z.infer<typeof AttachmentInfoSchema>;

/**
 * Sección de un comentario: bloque con su propio texto e imágenes. Las imágenes se reubican entre
 * secciones cambiando `attachments` (rutas que ya existen en el comentario; los archivos no se mueven).
 */
export const CommentSectionSchema = z
  .object({
    id: LocalIdSchema,
    title: z.string().max(LIMITS.sectionTitle).nullable(),
    text: z.string().max(LIMITS.sectionText),
    attachments: z.array(AttachmentPathSchema).max(LIMITS.attachments),
  })
  .strict();
export type CommentSection = z.infer<typeof CommentSectionSchema>;

// --- v2: propuestas (nunca modifican el proyecto observado) ---------------------

const proposalBase = {
  id: LocalIdSchema,
  /** Selector del elemento propuesto; null = el elemento principal de `location`. */
  targetSelector: z.string().min(1).max(LIMITS.selector).nullable(),
  note: z.string().max(LIMITS.text).nullable().optional(),
};
const proposalText = z.string().max(LIMITS.proposalText);

export const PROPOSAL_KINDS = ["text_fixed", "text_dynamic", "text_i18n", "style", "reorder"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Texto escrito directo en el código: antes → después. */
export const TextFixedProposalSchema = z
  .object({
    ...proposalBase,
    kind: z.literal("text_fixed"),
    before: proposalText,
    after: proposalText,
    source: LocationSourceSchema.nullable().optional(),
  })
  .strict();

/** Texto con variables del código ({count}); `variables` son fijas y deben conservarse en `after`. */
export const TextDynamicProposalSchema = z
  .object({
    ...proposalBase,
    kind: z.literal("text_dynamic"),
    before: proposalText,
    after: proposalText,
    variables: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(60), z.string().max(200))
      .refine((v) => Object.keys(v).length <= LIMITS.textVariables, "demasiadas variables"),
    source: LocationSourceSchema.nullable().optional(),
  })
  .strict();

export const I18nLocaleChangeSchema = z
  .object({
    locale: z.string().max(20).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
    /** null = sin traducir. */
    before: proposalText.nullable(),
    after: proposalText,
  })
  .strict();

/** Clave i18n: cambios por idioma. `scope: "one"` propone una clave nueva (`newKey`). */
export const TextI18nProposalSchema = z
  .object({
    ...proposalBase,
    kind: z.literal("text_i18n"),
    key: z.string().min(1).max(200),
    library: z.string().max(80).nullable(),
    uses: z.number().int().nonnegative().nullable(),
    scope: z.enum(["all", "one"]),
    newKey: z.string().min(1).max(200).nullable(),
    locales: z.array(I18nLocaleChangeSchema).min(1).max(LIMITS.i18nLocales),
    source: LocationSourceSchema.nullable().optional(),
  })
  .strict();

/** `editable`: valor de origen modificable; `foundation`: token/reset/preflight (solo referencia). */
export const STYLE_ORIGINS = ["editable", "foundation"] as const;
export const StyleOriginSchema = z.enum(STYLE_ORIGINS);
export type StyleOrigin = z.infer<typeof StyleOriginSchema>;

export const StyleChangeSchema = z
  .object({
    property: z.string().min(1).max(100),
    before: z.string().max(LIMITS.styleValue),
    after: z.string().max(LIMITS.styleValue),
    origin: StyleOriginSchema,
    /** Archivo:línea donde se define el valor. */
    source: LocationSourceSchema.nullable().optional(),
    /** Token de diseño asociado (p. ej. --pf-radius-md). */
    token: z.string().max(100).nullable().optional(),
  })
  .strict();
export type StyleChange = z.infer<typeof StyleChangeSchema>;

export const StyleProposalSchema = z
  .object({
    ...proposalBase,
    kind: z.literal("style"),
    appliesTo: z.enum(["focus", "all"]),
    changes: z.array(StyleChangeSchema).min(1).max(LIMITS.styleChanges),
  })
  .strict();

/** Reordenar hermanos: «mover de N a M» (posiciones 1-based entre `siblingCount` hermanos). */
export const ReorderProposalSchema = z
  .object({
    ...proposalBase,
    kind: z.literal("reorder"),
    parentSelector: z.string().min(1).max(LIMITS.selector).nullable(),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    siblingCount: z.number().int().positive().max(1000),
  })
  .strict();

export const CommentProposalSchema = z.discriminatedUnion("kind", [
  TextFixedProposalSchema,
  TextDynamicProposalSchema,
  TextI18nProposalSchema,
  StyleProposalSchema,
  ReorderProposalSchema,
]);
export type CommentProposal = z.infer<typeof CommentProposalSchema>;

// --- v2: grupo y cola de lectura -----------------------------------------------

/** Pertenencia a un grupo (nombre y nota viven en `ReadingGroup`). `position` ordena la cola (1-based). */
export const CommentGroupRefSchema = z
  .object({ id: GroupIdSchema, position: z.number().int().positive().max(LIMITS.groupItems) })
  .strict();
export type CommentGroupRef = z.infer<typeof CommentGroupRefSchema>;

/** Grupo de lectura: tema con nota de contexto; sus comentarios se leen en orden de `position`. */
export const ReadingGroupSchema = z
  .object({
    id: GroupIdSchema,
    name: z.string().min(1).max(LIMITS.groupName),
    note: z.string().max(LIMITS.groupNote),
    /** Quien ejecute debe leer la nota y toda la cola antes de actuar. */
    readFirst: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type ReadingGroup = z.infer<typeof ReadingGroupSchema>;

// --- Comentario ----------------------------------------------------------------

const commentShape = {
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
  attachments: z.array(AttachmentPathSchema).max(LIMITS.attachments),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  resolution: ResolutionSchema.nullable(),
};

/** Reglas cruzadas de las partes v2 (también las usa la request de creación). */
export function refineV2Parts(
  c: {
    scope: "element" | "view";
    attachments: string[];
    attachmentInfo: AttachmentInfo[];
    sections: CommentSection[];
    extraTargets: ExtraTarget[];
    proposals: CommentProposal[];
  },
  ctx: z.RefinementCtx,
): void {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const known = new Set(c.attachments);
  if (known.size !== c.attachments.length) bad(["attachments"], "adjuntos duplicados");
  const seenInfo = new Set<string>();
  c.attachmentInfo.forEach((a, i) => {
    if (!known.has(a.path)) bad(["attachmentInfo", i, "path"], "metadatos de un adjunto inexistente");
    if (seenInfo.has(a.path)) bad(["attachmentInfo", i, "path"], "metadatos duplicados");
    seenInfo.add(a.path);
  });
  const secIds = new Set<string>();
  const placed = new Set<string>();
  c.sections.forEach((s, i) => {
    if (secIds.has(s.id)) bad(["sections", i, "id"], "id de sección duplicado");
    secIds.add(s.id);
    s.attachments.forEach((p, j) => {
      if (!known.has(p)) bad(["sections", i, "attachments", j], "la sección referencia un adjunto inexistente");
      if (placed.has(p)) bad(["sections", i, "attachments", j], "un adjunto solo puede estar en una sección");
      placed.add(p);
    });
  });
  const tIds = new Set<string>();
  c.extraTargets.forEach((t, i) => {
    if (tIds.has(t.id)) bad(["extraTargets", i, "id"], "id de elemento duplicado");
    tIds.add(t.id);
  });
  if (c.scope === "view" && c.extraTargets.length > 0) bad(["extraTargets"], "scope view no admite elementos");
  const pIds = new Set<string>();
  c.proposals.forEach((p, i) => {
    if (pIds.has(p.id)) bad(["proposals", i, "id"], "id de propuesta duplicado");
    pIds.add(p.id);
    if (c.scope === "view" && p.targetSelector === null) {
      bad(["proposals", i, "targetSelector"], "scope view requiere targetSelector explícito");
    }
    if (p.kind === "reorder") {
      if (p.from === p.to) bad(["proposals", i, "to"], "from y to deben diferir");
      if (p.from > p.siblingCount || p.to > p.siblingCount) bad(["proposals", i, "to"], "posición fuera de siblingCount");
    }
    if (p.kind === "text_dynamic") {
      for (const name of Object.keys(p.variables)) {
        if (!p.after.includes(`{${name}}`)) bad(["proposals", i, "after"], `falta la variable {${name}}`);
      }
    }
    if (p.kind === "text_i18n") {
      if (p.scope === "one" && p.newKey === null) bad(["proposals", i, "newKey"], "scope one requiere newKey");
      const loc = new Set<string>();
      for (const l of p.locales) {
        if (loc.has(l.locale)) bad(["proposals", i, "locales"], `idioma duplicado ${l.locale}`);
        loc.add(l.locale);
      }
    }
  });
}

function refineElement(
  c: {
    scope: "element" | "view";
    location: { selector: string | null };
    elementRect: unknown;
    resolution: unknown;
    status: string;
  },
  ctx: z.RefinementCtx,
): void {
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
}

/** Comentario v2: lo que se persiste y devuelve la API. */
export const VisualCommentSchema = z
  .object({
    version: z.literal(COMMENT_VERSION),
    ...commentShape,
    /** Metadatos de `attachments` (nombre original, origen, tipo, tamaño). */
    attachmentInfo: z.array(AttachmentInfoSchema).max(LIMITS.attachments),
    sections: z.array(CommentSectionSchema).max(LIMITS.sections),
    /** Resto de la multiselección (el elemento principal es `location`). */
    extraTargets: z.array(ExtraTargetSchema).max(LIMITS.extraTargets),
    proposals: z.array(CommentProposalSchema).max(LIMITS.proposals),
    group: CommentGroupRefSchema.nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    refineElement(c, ctx);
    refineV2Parts(c, ctx);
  });
export type VisualComment = z.infer<typeof VisualCommentSchema>;

/** Forma v1 (solo para migrar). */
export const VisualCommentV1Schema = z
  .object({ version: z.literal(COMMENT_VERSION_V1), ...commentShape })
  .strict()
  .superRefine(refineElement);
export type VisualCommentV1 = z.infer<typeof VisualCommentV1Schema>;
