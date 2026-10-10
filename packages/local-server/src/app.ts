import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { ZodType } from "zod";
import {
  CreateCollectionRequestSchema,
  CreateCommentRequestSchema,
  ListCommentsQuerySchema,
  MoveCommentRequestSchema,
  OFFICIAL_EXTENSION_ID,
  PerfectFrontError,
  ResolveCommentRequestSchema,
  UpdateCommentRequestSchema,
  RegisterProjectRequestSchema,
  nowTimestamp,
  toErrorData,
  zodDetails,
  type ErrorCode,
  type ErrorResponse,
} from "@perfect-front/shared";
import { LIMITS, SERVER_FEATURES, SERVER_VERSION } from "./config";
import { BatchMoveRequestSchema, LogsQuerySchema } from "./contracts-extra";
import { EventBus } from "./events";
import { NullProcessController, type ProcessController } from "./process/controller";
import { ProjectRegistry } from "./registry";
import {
  RateLimiter,
  classifyOrigin,
  generateToken,
  isAllowedHost,
  originOf,
  parseBearer,
  parseExtensionIds,
  redact,
  safeEqual,
  type OriginKind,
} from "./security";
import { CommentsService } from "./services/comments";
import { ProcessesService } from "./services/processes";
import { ProjectsService } from "./services/projects";
import {
  DASHBOARD_CSP,
  MISSING_BUILD_MESSAGE,
  canInjectToken,
  defaultDashboardDir,
  injectToken,
  resolveStatic,
} from "./static";

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500> = {
  invalid_request: 400,
  invalid_id: 400,
  invalid_collection: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_version: 422,
  invalid_data: 422,
  storage_error: 500,
  process_error: 500,
  internal_error: 500,
};

type Role = "session" | "cli" | "extension";
type Env = { Variables: { role: Role; origin: OriginKind } };

export interface CoreOptions {
  stateDir: string;
  /** Token de sesión (dashboard). Se genera si falta. */
  token?: string;
  /** Token con permiso de CLI (registro de proyectos con raíz). Se genera si falta. */
  cliToken?: string;
  /**
   * IDs de extensión adicionales a la oficial (solo desarrollo; `PF_EXTENSION_IDS` en `startServer`).
   * Se validan con EXTENSION_ID_RE; uno inválido lanza error.
   */
  extensionIds?: readonly string[];
  processController?: ProcessController;
  /** Puerto real del servidor, para validar el puerto de la cabecera Host. null = no comprobar. */
  getPort?: () => number | null;
  /** Receptor de logs; recibe texto ya redactado. Por defecto, silencioso. */
  logger?: (line: string) => void;
  rateMax?: number;
  rateWindowMs?: number;
  authFailMax?: number;
  /** Carpeta del build del dashboard. Por defecto `apps/dashboard/dist`. */
  dashboardDir?: string;
}

export interface Core {
  app: Hono<Env>;
  bus: EventBus;
  registry: ProjectRegistry;
  token: string;
  cliToken: string;
  /** Cierra streams SSE y libera recursos. */
  close(): void;
}

export async function createCore(options: CoreOptions): Promise<Core> {
  const token = options.token ?? generateToken();
  const cliToken = options.cliToken ?? generateToken();
  // Confianza por ID fijo: el navegador impone el Origin de una extensión y una página web no puede falsificarlo.
  const extensionOrigins = new Set([OFFICIAL_EXTENSION_ID, ...parseExtensionIds(options.extensionIds ?? [])].map(originOf));
  const secrets = (): string[] => [token, cliToken];
  const log = (line: string): void => options.logger?.(redact(line, secrets()));
  const getPort = options.getPort ?? (() => null);
  const dashboardDir = options.dashboardDir ?? defaultDashboardDir();

  const bus = new EventBus();
  const registry = await ProjectRegistry.load(options.stateDir);
  const controller = options.processController ?? new NullProcessController();
  const projects = new ProjectsService(registry, bus, controller);
  const processes = new ProcessesService(projects, controller, bus, secrets);
  const comments = new CommentsService(registry, bus);

  const limiter = new RateLimiter(options.rateMax ?? LIMITS.rateMax, options.rateWindowMs ?? LIMITS.rateWindowMs);
  const authFails = new RateLimiter(options.authFailMax ?? LIMITS.authFailMax, options.rateWindowMs ?? LIMITS.rateWindowMs);

  const app = new Hono<Env>();

  const errorBody = (code: ErrorCode, message: string): ErrorResponse => ({ ok: false, error: { code, message } });
  const fail = (c: Context, code: ErrorCode, message: string, status: number = STATUS[code]): Response =>
    c.json(errorBody(code, message), status as 400);

  // --- Seguridad ---------------------------------------------------------------

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");

    // Host: loopback y puerto propio (defensa contra DNS rebinding).
    const urlHost = new URL(c.req.url).host;
    const headerHost = c.req.header("host");
    if (!isAllowedHost(urlHost, getPort()) || (headerHost !== undefined && !isAllowedHost(headerHost, getPort()))) {
      return fail(c, "forbidden_origin", "Host no permitido");
    }

    const originHeader = c.req.header("origin");
    const origin = classifyOrigin(originHeader, extensionOrigins);
    if (origin === null) return fail(c, "forbidden_origin", "Origen no autorizado");
    c.set("origin", origin);
    if (originHeader !== undefined) {
      c.header("Access-Control-Allow-Origin", originHeader);
      c.header("Vary", "Origin");
    }

    if (c.req.method === "OPTIONS") {
      if (originHeader === undefined) return fail(c, "invalid_request", "Preflight sin Origin", 400);
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-PF-Expected-Updated-At, X-PF-Include-Corrupt");
      c.header("Access-Control-Max-Age", "600");
      return c.body(null, 204);
    }

    if (!limiter.hit() || authFails.exceeded()) {
      c.header("Retry-After", "60");
      return fail(c, "invalid_request", "Demasiadas solicitudes", 429);
    }
    await next();
    return undefined;
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    // Extensión oficial (o de desarrollo): el Origin ya fue validado arriba; no lleva token y el rol
    // `extension` queda acotado a lectura de proyectos, comentarios y eventos.
    if (c.get("origin") === "extension") {
      c.set("role", "extension");
      return next();
    }
    let provided = parseBearer(c.req.header("authorization"));
    // EventSource no admite cabeceras: solo /api/events acepta el token por query.
    if (provided === null && c.req.path === "/api/events") provided = c.req.query("access_token") ?? null;
    let role: Role | null = null;
    if (provided !== null) {
      // Ambas comparaciones se ejecutan siempre (tiempo constante, sin cortocircuito).
      const isCli = safeEqual(provided, cliToken);
      const isSession = safeEqual(provided, token);
      role = isCli ? "cli" : isSession ? "session" : null;
    }
    if (role === null) {
      authFails.hit();
      c.header("WWW-Authenticate", "Bearer");
      return fail(c, "unauthorized", "Token ausente o inválido");
    }
    c.set("role", role);
    return next();
  });

  // --- Utilidades de ruta ------------------------------------------------------

  const jsonBody = bodyLimit({
    maxSize: LIMITS.jsonBody,
    onError: (c) => fail(c, "payload_too_large", "Cuerpo demasiado grande"),
  });
  const commentBody = bodyLimit({
    maxSize: LIMITS.commentBody,
    onError: (c) => fail(c, "payload_too_large", "Cuerpo demasiado grande"),
  });

  async function readBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
    // Exigir application/json fuerza preflight CORS en peticiones de navegador.
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new PerfectFrontError("invalid_request", "Content-Type debe ser application/json");
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new PerfectFrontError("invalid_request", "JSON inválido");
    }
    const r = schema.safeParse(raw);
    if (!r.success) throw new PerfectFrontError("invalid_request", "Datos inválidos", zodDetails(r.error));
    return r.data;
  }

  function readQuery<T>(c: Context, schema: ZodType<T>): T {
    const r = schema.safeParse(c.req.query());
    if (!r.success) throw new PerfectFrontError("invalid_request", "Parámetros inválidos", zodDetails(r.error));
    return r.data;
  }

  const requireCli = (c: Context<Env>): void => {
    if (c.get("role") !== "cli" || c.get("origin") !== "none") {
      throw new PerfectFrontError("forbidden_origin", "Operación reservada al CLI local");
    }
  };
  /** Procesos y logs: ni el overlay ni la extensión los administran (SPEC §3.3). */
  const forbidExtension = (c: Context<Env>): void => {
    if (c.get("role") === "extension") {
      throw new PerfectFrontError("forbidden_origin", "La extensión no puede administrar procesos");
    }
  };

  // --- Rutas -------------------------------------------------------------------

  // PF_TEST_HIDE_FEATURES=1: solo para pruebas; simula un servidor anterior a `features`.
  app.get("/api/health", (c) =>
    c.json({ ok: true, version: SERVER_VERSION, apiVersion: 1, ...(process.env.PF_TEST_HIDE_FEATURES === "1" ? {} : { features: [...SERVER_FEATURES] }) }),
  );

  app.get("/api/projects", async (c) => c.json({ ok: true, projects: await projects.list() }));

  app.post("/api/projects/register", jsonBody, async (c) => {
    requireCli(c);
    const body = await readBody(c, RegisterProjectRequestSchema);
    return c.json({ ok: true, project: await projects.register(body) }, 201);
  });

  app.delete("/api/projects/:id", async (c) => {
    requireCli(c);
    await projects.unregister(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/start", async (c) => {
    forbidExtension(c);
    const r = await processes.start(c.req.param("id"));
    return c.json({ ok: true, project: r.project, outcome: r.outcome });
  });

  app.post("/api/projects/:id/stop", async (c) => {
    forbidExtension(c);
    const r = await processes.stop(c.req.param("id"));
    return c.json({ ok: true, project: r.project, outcome: r.outcome });
  });

  app.get("/api/projects/:id/logs", async (c) => {
    forbidExtension(c);
    const q = readQuery(c, LogsQuerySchema);
    return c.json({ ok: true, lines: await processes.logs(c.req.param("id"), q.lines) });
  });

  app.get("/api/projects/:id/comments", async (c) => {
    const q = readQuery(c, ListCommentsQuerySchema);
    // El contrato de shared es estricto: `corrupt` (entradas ilegibles) solo se añade si el cliente lo pide.
    const r = await comments.listDetailed(c.req.param("id"), q);
    if (c.req.header("x-pf-include-corrupt") === "1") return c.json({ ok: true, comments: r.comments, corrupt: r.corrupt });
    return c.json({ ok: true, comments: r.comments });
  });

  app.post("/api/projects/:id/comments", commentBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, CreateCommentRequestSchema);
    return c.json({ ok: true, comment: await comments.create(id, body) }, 201);
  });

  // Antes de /:commentId para que "move" no se interprete como ID.
  app.post("/api/projects/:id/comments/move", jsonBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, BatchMoveRequestSchema);
    return c.json({ ok: true, results: await comments.moveMany(id, body.ids, body.to) });
  });

  app.get("/api/projects/:id/comments/:commentId", async (c) => {
    return c.json({ ok: true, comment: await comments.get(c.req.param("id"), c.req.param("commentId")) });
  });

  app.patch("/api/projects/:id/comments/:commentId", jsonBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, UpdateCommentRequestSchema);
    const expected = c.req.header("x-pf-expected-updated-at");
    return c.json({ ok: true, comment: await comments.update(id, c.req.param("commentId"), body, expected) });
  });

  /** Captura del comentario. Requiere token (el rol `extension` no la ve); el dashboard la pide con fetch + Bearer. */
  app.get("/api/projects/:id/comments/:commentId/attachments/:file", async (c) => {
    if (c.get("role") === "extension") {
      throw new PerfectFrontError("forbidden_origin", "La extensión no puede leer adjuntos");
    }
    const a = await comments.readAttachment(c.req.param("id"), c.req.param("commentId"), c.req.param("file"));
    c.header("Content-Type", a.mimeType);
    c.header("Content-Disposition", "inline");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(a.bytes as Uint8Array<ArrayBuffer>);
  });

  app.post("/api/projects/:id/comments/:commentId/move", jsonBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, MoveCommentRequestSchema);
    return c.json({ ok: true, comment: await comments.move(id, c.req.param("commentId"), body.to) });
  });

  app.post("/api/projects/:id/comments/:commentId/resolve", jsonBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, ResolveCommentRequestSchema);
    return c.json({ ok: true, comment: await comments.resolve(id, c.req.param("commentId"), body) });
  });

  app.post("/api/projects/:id/comments/:commentId/reopen", async (c) => {
    return c.json({ ok: true, comment: await comments.reopen(c.req.param("id"), c.req.param("commentId")) });
  });

  app.get("/api/projects/:id/collections", async (c) => {
    return c.json({ ok: true, collections: await comments.listCollections(c.req.param("id")) });
  });

  app.post("/api/projects/:id/collections", jsonBody, async (c) => {
    const id = c.req.param("id");
    registry.get(id);
    const body = await readBody(c, CreateCollectionRequestSchema);
    return c.json({ ok: true, collection: await comments.createCollection(id, body.name) }, 201);
  });

  // --- SSE ---------------------------------------------------------------------

  app.get("/api/events", (c) => {
    if (bus.size >= LIMITS.maxSseClients) return fail(c, "invalid_request", "Demasiados clientes de eventos", 429);
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let done!: () => void;
      const finished = new Promise<void>((r) => (done = r));
      const unsub = bus.subscribe((event, id) => {
        stream.writeSSE({ id: String(id), event: event.type, data: JSON.stringify(event) }).catch(done);
      });
      const unClose = bus.onClose(done);
      const beat = setInterval(() => {
        stream.write(`: ping ${nowTimestamp()}\n\n`).catch(done);
      }, LIMITS.sseHeartbeatMs);
      stream.onAbort(done);
      await stream.write(": connected\n\n");
      try {
        await finished;
      } finally {
        clearInterval(beat);
        unsub();
        unClose();
      }
    });
  });

  // --- Dashboard estático ------------------------------------------------------

  // Solo GET/HEAD (Hono atiende HEAD con los handlers GET). /api/* nunca cae aquí: un /api/ desconocido
  // sigue siendo 404 JSON. El token se inyecta únicamente si `canInjectToken` lo permite (ver static.ts).
  app.get("*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return fail(c, "not_found", "Ruta no encontrada");
    const r = await resolveStatic(dashboardDir, c.req.path);
    if (r.kind === "bad-path") return fail(c, "invalid_request", "Ruta no válida", 400);
    if (r.kind === "not-found") return fail(c, "not_found", "Ruta no encontrada");
    if (r.kind === "missing-build") {
      return c.text(MISSING_BUILD_MESSAGE, 503, { "Content-Type": "text/plain; charset=utf-8" });
    }
    c.header("Content-Type", r.contentType);
    if (r.isIndex) {
      c.header("Content-Security-Policy", DASHBOARD_CSP);
      c.header("X-Frame-Options", "DENY");
      c.header("Referrer-Policy", "no-referrer");
      const html = new TextDecoder().decode(r.body);
      return c.body(canInjectToken(c.req, getPort()) ? injectToken(html, token) : html);
    }
    return c.body(r.body as Uint8Array<ArrayBuffer>);
  });

  // --- Errores -----------------------------------------------------------------

  app.notFound((c) => fail(c, "not_found", "Ruta no encontrada"));

  app.onError((err, c) => {
    const data = toErrorData(err);
    if (data.code === "internal_error") {
      // Sin stack ni rutas: solo tipo y mensaje redactados.
      log(`internal error: ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}`);
    }
    return c.json({ ok: false, error: data } satisfies ErrorResponse, STATUS[data.code]);
  });

  return {
    app,
    bus,
    registry,
    token,
    cliToken,
    close: () => bus.close(),
  };
}
