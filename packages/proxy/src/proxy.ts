import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import {
  CommentCreatedDataSchema,
  CreateCommentRequestSchema,
  CreateAgentRequestSchema,
  CreateGroupRequestSchema,
  PerfectFrontError,
  ReorderGroupRequestSchema,
  UpdateCommentRequestSchema,
  UpdateGroupRequestSchema,
  toErrorData,
} from "@perfect-front/shared";
import type { ErrorCode, PerfectFrontErrorData } from "@perfect-front/shared";
import { buildSnippet, injectSnippet } from "./inject";

export interface ProxyOptions {
  target: { host: string; port: number };
  listenPort?: number;
  projectId: string;
  localServer: { baseUrl: string; token: string };
  getOverlayScript: () => Promise<string>;
  log?: (line: string) => void;
}
export interface ProxyHandle {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const FIRST_PORT = 7788;
const PORT_TRIES = 50;
const MAX_BODY = 14 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_EVENT_STREAMS = 8;
const EVENT_HEARTBEAT_MS = 15_000;
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization"];

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  invalid_request: 400,
  invalid_id: 400,
  invalid_collection: 400,
  invalid_data: 400,
  unsupported_version: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
};

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e);
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const { target, projectId, localServer, getOverlayScript } = options;
  const token = randomBytes(24).toString("hex");
  const snippet = buildSnippet(token);
  const secrets = [token, localServer.token].filter((s) => s.length > 0);
  const redact = (s: string): string => secrets.reduce((acc, secret) => acc.split(secret).join("[redacted]"), s);
  const log = (line: string): void => options.log?.(redact(line));
  const targetHostPort = `${target.host}:${target.port}`;
  /** Origen del destino: lo que ve el dev server si la página se abriera directamente. */
  const targetOrigin = `http://${targetHostPort}`;
  let ownPort = 0;

  const sockets = new Set<net.Socket>();

  // --- utilidades de respuesta -------------------------------------------------------------------------------

  const sendText = (res: http.ServerResponse, status: number, text: string, extra: http.OutgoingHttpHeaders = {}): void => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = Buffer.from(text, "utf8");
    res.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    });
    res.end(body);
  };

  const sendJson = (res: http.ServerResponse, status: number, payload: unknown): void => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  };

  const sendError = (res: http.ServerResponse, err: unknown, status?: number): void => {
    const error: PerfectFrontErrorData = toErrorData(err);
    error.message = redact(error.message);
    sendJson(res, status ?? STATUS_BY_CODE[error.code] ?? 500, { ok: false, error });
  };

  // --- validación de Host / Origin / token -------------------------------------------------------------------

  const hostAllowed = (host: string | undefined): boolean => {
    if (!host) return false;
    const m = /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/i.exec(host);
    return m !== null && Number(m[2]) === ownPort;
  };

  /** Origin ausente, o exactamente el origen por el que la página llegó al proxy (Host ya validado). */
  const originAllowed = (req: http.IncomingMessage): boolean => {
    const origin = req.headers.origin;
    return origin === undefined || origin === `http://${req.headers.host}`;
  };

  const tokenValid = (req: http.IncomingMessage): boolean => {
    const h = req.headers["x-pf-token"];
    return typeof h === "string" && safeEqual(h, token);
  };

  // --- cliente del servidor local ----------------------------------------------------------------------------

  /** `editor_not_found` no esta en ErrorCode de shared: se reenvia tal cual (424) al overlay. */
  class EditorNotFoundForward extends Error {}

  const callLocal = async (method: "GET" | "POST" | "PATCH" | "DELETE", body?: string, sub = "/comments", extra: Record<string, string> = {}): Promise<Record<string, unknown>> => {
    const url = `${localServer.baseUrl.replace(/\/+$/, "")}/api/projects/${encodeURIComponent(projectId)}${sub}`;
    let r: Response;
    try {
      r = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${localServer.token}`,
          ...extra,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw new PerfectFrontError("internal_error", "No se pudo contactar al servidor local de Perfect Front; ¿sigue en ejecución?");
    }
    let json: unknown = null;
    try {
      json = await r.json();
    } catch {
      /* cuerpo no JSON */
    }
    const obj = (json ?? {}) as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
    if (!r.ok || obj.ok !== true) {
      const code = typeof obj.error?.code === "string" ? (obj.error.code as ErrorCode) : "internal_error";
      const message = typeof obj.error?.message === "string" ? obj.error.message : `El servidor local respondió ${r.status}`;
      if ((obj.error?.code as unknown) === "editor_not_found") throw new EditorNotFoundForward(message.slice(0, 500));
      if (code === "unauthorized") {
        throw new PerfectFrontError("internal_error", "El proxy no está autorizado ante el servidor local (token rechazado)");
      }
      throw new PerfectFrontError(code in STATUS_BY_CODE ? code : "internal_error", message.slice(0, 500));
    }
    return obj as Record<string, unknown>;
  };

  const pick = (c: unknown): unknown => {
    const o = (c ?? {}) as Record<string, unknown>;
    const loc = (o.location ?? {}) as Record<string, unknown>;
    return {
      id: o.id,
      status: o.status,
      scope: o.scope,
      comment: o.comment,
      location: { route: loc.route, selector: loc.selector ?? null, selectorCandidates: loc.selectorCandidates ?? [] },
      elementRect: o.elementRect ?? null,
      group: o.group ?? null,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  };

  /** Rutas dinámicas de grupos y PATCH de comentario; el id debe ser un token simple (sin `/`, `.` ni `%`). */
  const ID = "([A-Za-z0-9_-]{1,128})";
  /** Cuerpo de `/__pf/open`: `{file, line?, column?}` (el servidor local valida la ruta contra la raiz del proyecto). */
  const OpenSchema = {
    safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } {
      const o = v as Record<string, unknown> | null;
      if (o === null || typeof o !== "object" || Array.isArray(o)) return { success: false, error: new PerfectFrontError("invalid_request", "Datos inválidos") };
      const bad = Object.keys(o).some((k) => !["file", "line", "column"].includes(k));
      const int = (x: unknown, max: number): boolean => x === undefined || (typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= max);
      if (bad || typeof o.file !== "string" || o.file.length < 1 || o.file.length > 1024 || !int(o.line, 10_000_000) || !int(o.column, 100_000)) {
        return { success: false, error: new PerfectFrontError("invalid_request", "Datos inválidos") };
      }
      return { success: true, data: { file: o.file, ...(o.line !== undefined ? { line: o.line } : {}), ...(o.column !== undefined ? { column: o.column } : {}) } };
    },
  };
  type Dyn = { sub: string; schema?: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }; status: number };
  const dynamicRoute = (pathname: string, method: string): Dyn | "method" | null => {
    let m: RegExpExecArray | null;
    if (pathname === "/__pf/groups") {
      if (method === "GET") return { sub: "/groups", status: 200 };
      if (method === "POST") return { sub: "/groups", schema: CreateGroupRequestSchema, status: 201 };
      return "method";
    }
    if (pathname === "/__pf/open") return method === "POST" ? { sub: "/open", schema: OpenSchema, status: 200 } : "method";
    if (pathname === "/__pf/agent/requests") {
      if (method === "GET") return { sub: "/agent/requests", status: 200 };
      if (method === "POST") return { sub: "/agent/requests", schema: CreateAgentRequestSchema, status: 201 };
      return "method";
    }
    if ((m = new RegExp(`^/__pf/groups/${ID}/reorder$`).exec(pathname))) {
      return method === "POST" ? { sub: `/groups/${m[1]}/reorder`, schema: ReorderGroupRequestSchema, status: 200 } : "method";
    }
    if ((m = new RegExp(`^/__pf/groups/${ID}$`).exec(pathname))) {
      if (method === "PATCH") return { sub: `/groups/${m[1]}`, schema: UpdateGroupRequestSchema, status: 200 };
      if (method === "DELETE") return { sub: `/groups/${m[1]}`, status: 200 };
      return "method";
    }
    if ((m = new RegExp(`^/__pf/comments/${ID}$`).exec(pathname))) {
      if (method === "PATCH") return { sub: `/comments/${m[1]}`, schema: UpdateCommentRequestSchema, status: 200 };
      if (method === "DELETE") return { sub: `/comments/${m[1]}`, status: 200 };
      return "method";
    }
    return null;
  };

  const readBody = (req: http.IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let exceeded = false;
      let settled = false;
      const done = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY) {
          exceeded = true;
          chunks.length = 0;
          if (total > MAX_BODY * 2) req.destroy(); // tope duro del drenaje
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () =>
        done(() =>
          exceeded ? reject(new PerfectFrontError("payload_too_large", "El comentario supera el tamaño máximo permitido")) : resolve(Buffer.concat(chunks)),
        ),
      );
      req.on("error", () => done(() => reject(new PerfectFrontError("invalid_request", "No se pudo leer el cuerpo de la petición"))));
      req.on("close", () => {
        if (!req.complete) done(() => reject(new PerfectFrontError("invalid_request", "Petición interrumpida")));
      });
    });

  // --- SSE /__pf/events --------------------------------------------------------------------------------------

  const streams = new Set<() => void>();

  /**
   * Reenvía `/api/events` del servidor local filtrando por el proyecto de este proxy. EventSource no admite
   * cabeceras: aquí (y solo aquí) el token del overlay también se acepta por query `pf_token`. Solo salen
   * eventos de comentarios/colecciones con datos mínimos (sin capturas ni textos).
   */
  const handleEvents = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!originAllowed(req)) return sendError(res, new PerfectFrontError("forbidden_origin", "Origen no permitido"));
    let provided: string | undefined | null = typeof req.headers["x-pf-token"] === "string" ? req.headers["x-pf-token"] : undefined;
    if (provided === undefined) {
      try {
        provided = new URL(req.url ?? "/", "http://x").searchParams.get("pf_token");
      } catch {
        provided = null;
      }
    }
    if (typeof provided !== "string" || !safeEqual(provided, token)) {
      return sendError(res, new PerfectFrontError("unauthorized", "Token del proxy ausente o inválido"));
    }
    if (streams.size >= MAX_EVENT_STREAMS) return sendError(res, new PerfectFrontError("invalid_request", "Demasiados clientes de eventos"), 429);

    const ctrl = new AbortController();
    let closed = false;
    let beat: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (closed) return;
      closed = true;
      if (beat) clearInterval(beat);
      streams.delete(stop);
      ctrl.abort();
      if (!res.writableEnded) res.end();
    };
    streams.add(stop);
    res.on("close", stop);

    let upstream: Response;
    const connectTimer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      upstream = await fetch(`${localServer.baseUrl.replace(/\/+$/, "")}/api/events`, {
        headers: { authorization: `Bearer ${localServer.token}`, accept: "text/event-stream" },
        signal: ctrl.signal,
      });
    } catch {
      clearTimeout(connectTimer);
      const wasClosed = closed;
      stop();
      if (!wasClosed && !res.headersSent) sendError(res, new PerfectFrontError("internal_error", "No se pudo contactar al servidor local de Perfect Front"));
      return;
    }
    clearTimeout(connectTimer);
    if (!upstream.ok || !upstream.body) {
      const status = upstream.status === 429 ? 429 : 502;
      upstream.body?.cancel().catch(() => undefined);
      streams.delete(stop);
      closed = true;
      return sendError(res, new PerfectFrontError(status === 429 ? "invalid_request" : "internal_error", "El servidor local no admite más clientes de eventos"), status);
    }
    if (closed) return;

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    res.write(": connected\n\n");
    beat = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, EVENT_HEARTBEAT_MS);

    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let buf = "";
    type Ev = { type?: unknown; projectId?: unknown; at?: unknown; commentId?: unknown; comment?: { id?: unknown; status?: unknown; updatedAt?: unknown } };
    const forward = (frame: string): void => {
      let id = "";
      let data = "";
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trimStart();
      }
      if (!data) return; // comentarios/heartbeats del servidor: el proxy emite los suyos
      let ev: Ev;
      try {
        ev = JSON.parse(data) as Ev;
      } catch {
        return;
      }
      if (ev.projectId !== projectId || typeof ev.type !== "string" || !/^(comment|collection)\./.test(ev.type)) return;
      const slim = {
        type: ev.type,
        projectId,
        at: ev.at,
        commentId: typeof ev.commentId === "string" ? ev.commentId : ev.comment?.id,
        status: ev.comment?.status,
        updatedAt: ev.comment?.updatedAt,
      };
      res.write(`${/^\d{1,16}$/.test(id) ? `id: ${id}\n` : ""}event: ${ev.type}\ndata: ${JSON.stringify(slim)}\n\n`);
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.length > 1024 * 1024) buf = ""; // trama anómala: se descarta
        for (let m = /\r?\n\r?\n/.exec(buf); m && !closed; m = /\r?\n\r?\n/.exec(buf)) {
          const frame = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          forward(frame);
        }
        // Contrapresión: si el navegador no drena, se pausa la lectura del upstream.
        if (res.writableNeedDrain && !closed) {
          await new Promise<void>((r) => {
            res.once("drain", r);
            res.once("close", r);
          });
        }
      }
    } catch {
      /* upstream cortado o abortado */
    } finally {
      reader.cancel().catch(() => undefined);
      stop();
    }
  };

  // --- rutas propias /__pf/ ----------------------------------------------------------------------------------

  const handleOwn = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> => {
    const method = req.method ?? "GET";
    const routes: Record<string, string> = {
      "/__pf/overlay.js": "GET",
      "/__pf/health": "GET",
      "/__pf/comments": "GET",
      "/__pf/comment": "POST",
      "/__pf/events": "GET",
    };
    const dyn = Object.hasOwn(routes, pathname) ? null : dynamicRoute(pathname, method);
    if (dyn === "method") return sendError(res, new PerfectFrontError("invalid_request", "Método no permitido"), 405);
    if (dyn) {
      if (!originAllowed(req)) return sendError(res, new PerfectFrontError("forbidden_origin", "Origen no permitido"));
      if (!tokenValid(req)) return sendError(res, new PerfectFrontError("unauthorized", "Token del proxy ausente o inválido"));
      try {
        let payload: string | undefined;
        if (dyn.schema) {
          const raw = await readBody(req);
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(raw.toString("utf8"));
          } catch {
            throw new PerfectFrontError("invalid_request", "El cuerpo no es JSON válido");
          }
          const parsed = dyn.schema.safeParse(parsedJson);
          if (!parsed.success) throw parsed.error;
          payload = JSON.stringify(parsed.data);
        }
        // Control de concurrencia del PATCH de comentario: se reenvía tal cual (el servidor compara con updatedAt).
        const expected = req.headers["x-pf-expected-updated-at"];
        const extra = typeof expected === "string" && expected.length <= 64 ? { "x-pf-expected-updated-at": expected } : {};
        const json = await callLocal(method as "GET" | "POST" | "PATCH" | "DELETE", payload, dyn.sub, extra);
        return sendJson(res, dyn.status, json);
      } catch (e) {
        if (e instanceof EditorNotFoundForward) return sendJson(res, 424, { ok: false, error: { code: "editor_not_found", message: redact(e.message) } });
        return sendError(res, e);
      }
    }
    const allowed = Object.hasOwn(routes, pathname) ? routes[pathname] : undefined;
    if (!allowed) return sendError(res, new PerfectFrontError("not_found", "Ruta no encontrada"));
    if (method !== allowed) {
      res.setHeader("allow", allowed);
      return sendError(res, new PerfectFrontError("invalid_request", "Método no permitido"), 405);
    }

    if (pathname === "/__pf/health") return sendJson(res, 200, { ok: true });
    if (pathname === "/__pf/events") return handleEvents(req, res);

    if (pathname === "/__pf/overlay.js") {
      try {
        const js = Buffer.from(await getOverlayScript(), "utf8");
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "content-length": js.length,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(js);
      } catch (e) {
        const msg = redact(e instanceof Error ? e.message : String(e));
        log(`overlay: no se pudo leer el script (${msg})`);
        sendText(res, 500, `Perfect Front: no se pudo cargar el overlay (${msg}).\nCompila el paquete del overlay y recarga la página.`);
      }
      return;
    }

    // Lecturas y escrituras de comentarios: Origin propio + token del proxy.
    if (!originAllowed(req)) return sendError(res, new PerfectFrontError("forbidden_origin", "Origen no permitido"));
    if (!tokenValid(req)) return sendError(res, new PerfectFrontError("unauthorized", "Token del proxy ausente o inválido"));

    try {
      if (pathname === "/__pf/comments") {
        const json = await callLocal("GET");
        const list = Array.isArray(json.comments) ? (json.comments as unknown[]) : [];
        return sendJson(res, 200, { ok: true, data: { comments: list.map(pick) } });
      }
      // POST /__pf/comment
      const raw = await readBody(req);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new PerfectFrontError("invalid_request", "El cuerpo no es JSON válido");
      }
      const parsed = CreateCommentRequestSchema.safeParse(parsedJson);
      if (!parsed.success) throw parsed.error;
      const json = await callLocal("POST", JSON.stringify(parsed.data));
      const comment = (json.comment ?? {}) as { id?: unknown; collection?: unknown; location?: { route?: unknown } };
      const data = CommentCreatedDataSchema.parse({
        id: comment.id,
        collection: comment.collection,
        route: comment.location?.route,
      });
      sendJson(res, 201, { ok: true, data });
    } catch (e) {
      sendError(res, e);
    }
  };

  // --- proxy HTTP ----------------------------------------------------------------------------------------------

  const sameAsTarget = (u: URL): boolean => {
    const loop = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const port = Number(u.port || 80);
    if (port !== target.port) return false;
    const h = u.hostname.toLowerCase();
    const t = target.host.toLowerCase();
    return h === t || (loop.has(h) && (loop.has(t) || loop.has(`[${t}]`)));
  };

  const rewriteLocation = (value: string, proxyOrigin: string): string => {
    try {
      const u = new URL(value);
      if (u.protocol === "http:" && sameAsTarget(u)) return proxyOrigin + u.pathname + u.search + u.hash;
    } catch {
      /* relativo: queda igual */
    }
    return value;
  };

  /**
   * `Origin` que apunta al proxy -> origen del destino. Los dev servers (Next `allowedDevOrigins`, Vite/Angular
   * `allowedHosts`/CORS) rechazan peticiones y WebSockets de HMR con un Origin ajeno al suyo. Cualquier otro valor
   * (un origen de terceros real, `null`) se deja intacto.
   */
  const rewriteOriginHeader = (value: string, proxyOrigin: string): string => (value === proxyOrigin ? targetOrigin : value);

  /** `Referer` que empieza por el origen del proxy -> mismo camino sobre el origen del destino. */
  const rewriteRefererHeader = (value: string, proxyOrigin: string): string => {
    if (!value.startsWith(proxyOrigin)) return value;
    const rest = value.slice(proxyOrigin.length);
    return rest === "" || /^[/?#]/.test(rest) ? targetOrigin + rest : value;
  };

  const cspBlocks = (csp: string): boolean => /(^|;)\s*(script-src|default-src)\b/i.test(csp);

  const proxyHttp = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    delete headers["accept-encoding"];
    headers.host = targetHostPort;
    const proxyOrigin = `http://${req.headers.host}`;
    if (typeof headers.origin === "string") headers.origin = rewriteOriginHeader(headers.origin, proxyOrigin);
    if (typeof headers.referer === "string") headers.referer = rewriteRefererHeader(headers.referer, proxyOrigin);

    const up = http.request(
      { host: target.host, port: target.port, method: req.method, path: req.url, headers, agent: false },
      (upRes) => {
        const status = upRes.statusCode ?? 502;
        const out: http.OutgoingHttpHeaders = { ...upRes.headers };
        for (const h of HOP_BY_HOP) delete out[h];
        if (typeof out.location === "string") out.location = rewriteLocation(out.location, `http://${req.headers.host}`);
        const csp = upRes.headers["content-security-policy"];
        const type = String(upRes.headers["content-type"] ?? "");
        const isHtml = /text\/html/i.test(type);

        if (isHtml && typeof csp === "string" && cspBlocks(csp)) {
          log(`aviso: ${req.url} trae Content-Security-Policy con script-src/default-src; puede bloquear el overlay (no se modifica)`);
        }
        const encoding = String(upRes.headers["content-encoding"] ?? "").toLowerCase();
        const compressed = encoding !== "" && encoding !== "identity";
        const bodiless = req.method === "HEAD" || status === 204 || status === 304 || status < 200;
        const utf16 = /charset=utf-?16/i.test(type);

        if (isHtml && compressed) log(`aviso: ${req.url} llegó comprimido (${encoding}); no se inyecta el overlay`);
        const inject = isHtml && !compressed && !bodiless && !utf16;

        upRes.on("error", () => res.destroy());
        if (inject) {
          const chunks: Buffer[] = [];
          upRes.on("data", (c: Buffer) => chunks.push(c));
          upRes.on("end", () => {
            // latin1 conserva los bytes exactos (el snippet es ASCII) con cualquier codificación ASCII-compatible.
            const html = injectSnippet(Buffer.concat(chunks).toString("latin1"), snippet);
            const body = Buffer.from(html, "latin1");
            delete out["transfer-encoding"];
            out["content-length"] = body.length;
            out["cache-control"] = "no-store";
            res.writeHead(status, upRes.statusMessage, out);
            res.end(body);
          });
          return;
        }
        if (isHtml) {
          out["cache-control"] = "no-store";
          if (req.method === "HEAD") delete out["content-length"]; // el GET real crece con la inyección
        }
        res.writeHead(status, upRes.statusMessage, out);
        upRes.pipe(res);
      },
    );
    up.on("socket", (s) => {
      sockets.add(s);
      s.once("close", () => sockets.delete(s));
    });
    up.on("error", (e: NodeJS.ErrnoException) => {
      sendText(res, 502, `perfect-front: el destino ${targetHostPort} no responde (${e.code ?? e.message}).\n¿Sigue corriendo el servidor de desarrollo?`);
    });
    res.on("close", () => up.destroy());
    req.on("error", () => up.destroy());
    req.pipe(up);
  };

  const server = http.createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      return sendText(res, 403, "perfect-front: Host no permitido (solo loopback y el puerto del proxy).");
    }
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      return sendText(res, 400, "perfect-front: URL inválida.");
    }
    if (pathname === "/__pf" || pathname.startsWith("/__pf/")) {
      handleOwn(req, res, pathname).catch((e) => {
        log(`error interno: ${e instanceof Error ? e.message : String(e)}`);
        sendError(res, e);
      });
      return;
    }
    proxyHttp(req, res);
  });

  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });

  // --- WebSocket / upgrade: túnel de sockets crudos ------------------------------------------------------------

  server.on("upgrade", (req, socket, head) => {
    const refuse = (line: string): void => {
      socket.end(`HTTP/1.1 ${line}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
    };
    if (!hostAllowed(req.headers.host)) return refuse("403 Forbidden");
    if (/^\/__pf(\/|$|\?)/.test(req.url ?? "")) return refuse("404 Not Found");

    const upstream = net.connect(target.port, target.host);
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    const fail = (): void => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on("error", fail);
    upstream.on("error", fail);
    socket.once("close", () => upstream.destroy());
    upstream.once("close", () => socket.destroy());
    upstream.once("connect", () => {
      // Cabeceras originales (nombre y orden crudos); solo se reescriben Host, Origin y Referer hacia el destino.
      const proxyOrigin = `http://${req.headers.host}`;
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i] ?? "";
        const original = req.rawHeaders[i + 1] ?? "";
        const lower = name.toLowerCase();
        const value =
          lower === "host"
            ? targetHostPort
            : lower === "origin"
              ? rewriteOriginHeader(original, proxyOrigin)
              : lower === "referer"
                ? rewriteRefererHeader(original, proxyOrigin)
                : original;
        raw += `${name}: ${value}\r\n`;
      }
      upstream.write(raw + "\r\n");
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });

  // --- arranque ----------------------------------------------------------------------------------------------------

  if (options.listenPort !== undefined) {
    await listen(server, options.listenPort);
  } else {
    let bound = false;
    for (let i = 0; i <= PORT_TRIES && !bound; i++) {
      try {
        await listen(server, FIRST_PORT + i);
        bound = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      }
    }
    if (!bound) throw new Error(`No hay puerto libre entre ${FIRST_PORT} y ${FIRST_PORT + PORT_TRIES}`);
  }
  ownPort = (server.address() as net.AddressInfo).port;
  const url = `http://${HOST}:${ownPort}`;
  log(`proxy escuchando en ${url} -> ${targetHostPort}`);

  let closing: Promise<void> | null = null;
  return {
    url,
    port: ownPort,
    token,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve) => {
        for (const stop of [...streams]) stop();
        server.close(() => resolve());
        server.closeAllConnections();
        for (const s of sockets) s.destroy();
        sockets.clear();
      });
      return closing;
    },
  };
}
