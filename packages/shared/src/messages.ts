import { z } from "zod";
import { CreateCommentRequestSchema, ProjectSummarySchema, ScreenshotUploadSchema } from "./api";
import { PerfectFrontErrorSchema } from "./errors";
import { CollectionNameSchema, CommentIdSchema, ProjectIdSchema } from "./ids";

/**
 * Protocolo de mensajes internos de la extensión (popup / content script / service worker).
 * Todo mensaje cruza un límite de confianza: el receptor SIEMPRE lo valida con estos esquemas.
 * Ningún mensaje transporta rutas absolutas del filesystem.
 *
 * Modelo de confianza: no hay emparejamiento. El servidor local reconoce a la extensión oficial por su
 * ID fijo (origen `chrome-extension://<EXTENSION_ID>`), que el navegador impone y una página web no
 * puede falsificar. Ese rol solo puede leer proyectos y gestionar comentarios; nunca registrar
 * proyectos ni controlar procesos.
 */
export const EXTENSION_PROTOCOL_VERSION = 1 as const;

/** ID fijo de la extensión oficial (derivado de la clave pública incluida en apps/extension). */
export const OFFICIAL_EXTENSION_ID = "joggpgkomcopmidkklfcapadaipimjef" as const;
export const EXTENSION_ID_RE = /^[a-p]{32}$/;

/** Rango de puertos donde la extensión busca servidores locales de Perfect Front. */
export const SERVER_PORT_RANGE = { first: 45800, last: 45820 } as const;

const base = { v: z.literal(EXTENSION_PROTOCOL_VERSION) };
const PortSchema = z.number().int().min(SERVER_PORT_RANGE.first).max(SERVER_PORT_RANGE.last);

// --- Content script / popup -> service worker (requests) ---

/** El content script pregunta si su pestaña pertenece a un proyecto registrado. */
export const ContextGetMessageSchema = z
  .object({ ...base, type: z.literal("pf/context.get"), url: z.string().url().max(2048) })
  .strict();

/** El popup pide la pestaña activa + estado de la capa. */
export const StatusGetMessageSchema = z
  .object({ ...base, type: z.literal("pf/status.get"), tabId: z.number().int().nonnegative().optional() })
  .strict();

/** El popup pide los servidores en ejecución y sus proyectos. */
export const ProjectsListMessageSchema = z.object({ ...base, type: z.literal("pf/projects.list") }).strict();

/** El popup abre un proyecto: enfoca la pestaña con su URL o crea una nueva. */
export const ProjectOpenMessageSchema = z
  .object({ ...base, type: z.literal("pf/project.open"), port: PortSchema, projectId: ProjectIdSchema })
  .strict();

/** Lee la preferencia global de la capa de comentarios (predeterminada: activa). */
export const LayerGetMessageSchema = z.object({ ...base, type: z.literal("pf/layer.get") }).strict();

/** Enciende o apaga la capa en todas las pestañas de proyectos registrados. */
export const LayerSetMessageSchema = z
  .object({ ...base, type: z.literal("pf/layer.set"), enabled: z.boolean() })
  .strict();

/** El content script crea un comentario; el servidor revalida el payload completo. */
export const CommentCreateMessageSchema = z
  .object({
    ...base,
    type: z.literal("pf/comment.create"),
    projectId: ProjectIdSchema,
    comment: CreateCommentRequestSchema,
  })
  .strict();

/** El content script pide una captura explícita de la pestaña visible (captureVisibleTab). */
export const CaptureRequestMessageSchema = z.object({ ...base, type: z.literal("pf/capture.request") }).strict();

/** Mensajes que recibe el service worker. */
export const ToServiceWorkerMessageSchema = z.discriminatedUnion("type", [
  ContextGetMessageSchema,
  StatusGetMessageSchema,
  ProjectsListMessageSchema,
  ProjectOpenMessageSchema,
  LayerGetMessageSchema,
  LayerSetMessageSchema,
  CommentCreateMessageSchema,
  CaptureRequestMessageSchema,
]);
export type ToServiceWorkerMessage = z.infer<typeof ToServiceWorkerMessageSchema>;

// --- Service worker -> content script (push) ---

export const OverlaySetMessageSchema = z
  .object({ ...base, type: z.literal("pf/overlay.set"), enabled: z.boolean() })
  .strict();

/** Mensajes que recibe el content script. */
export const ToContentMessageSchema = z.discriminatedUnion("type", [OverlaySetMessageSchema]);
export type ToContentMessage = z.infer<typeof ToContentMessageSchema>;

// --- Respuestas (datos por tipo de request) ---

export const ContextDataSchema = z
  .object({
    registered: z.boolean(),
    projectId: ProjectIdSchema.optional(),
    projectName: z.string().max(200).optional(),
    pending: z.number().int().nonnegative().optional(),
    /** Preferencia global de la capa: el content script la activa al cargar si es true. */
    layerEnabled: z.boolean(),
  })
  .strict();
export type ContextData = z.infer<typeof ContextDataSchema>;

export const StatusDataSchema = z
  .object({
    /** unreachable = ningún servidor local respondió en el rango de puertos. */
    server: z.enum(["connected", "unreachable"]),
    context: ContextDataSchema.optional(),
    layerEnabled: z.boolean(),
  })
  .strict();
export type StatusData = z.infer<typeof StatusDataSchema>;

export const RunningServerSchema = z
  .object({ port: PortSchema, projects: z.array(ProjectSummarySchema) })
  .strict();
export type RunningServer = z.infer<typeof RunningServerSchema>;

export const ProjectsListDataSchema = z.object({ servers: z.array(RunningServerSchema) }).strict();
export type ProjectsListData = z.infer<typeof ProjectsListDataSchema>;

export const ProjectOpenedDataSchema = z
  .object({ tabId: z.number().int().nonnegative(), created: z.boolean() })
  .strict();
export type ProjectOpenedData = z.infer<typeof ProjectOpenedDataSchema>;

export const LayerDataSchema = z.object({ enabled: z.boolean() }).strict();
export type LayerData = z.infer<typeof LayerDataSchema>;

export const CommentCreatedDataSchema = z
  .object({ id: CommentIdSchema, collection: CollectionNameSchema, route: z.string().max(2048) })
  .strict();
export type CommentCreatedData = z.infer<typeof CommentCreatedDataSchema>;

export const CaptureDataSchema = z.object({ screenshot: ScreenshotUploadSchema }).strict();
export type CaptureData = z.infer<typeof CaptureDataSchema>;

/** Respuesta genérica: éxito con datos o error serializable con código estable. */
export function messageResponseSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.object({ ok: z.literal(true), data }).strict(),
    z.object({ ok: z.literal(false), error: PerfectFrontErrorSchema }).strict(),
  ]);
}

/** Esquema de respuesta por tipo de mensaje. */
export const MESSAGE_RESPONSE_SCHEMAS = {
  "pf/context.get": messageResponseSchema(ContextDataSchema),
  "pf/status.get": messageResponseSchema(StatusDataSchema),
  "pf/projects.list": messageResponseSchema(ProjectsListDataSchema),
  "pf/project.open": messageResponseSchema(ProjectOpenedDataSchema),
  "pf/layer.get": messageResponseSchema(LayerDataSchema),
  "pf/layer.set": messageResponseSchema(LayerDataSchema),
  "pf/comment.create": messageResponseSchema(CommentCreatedDataSchema),
  "pf/capture.request": messageResponseSchema(CaptureDataSchema),
} as const;
