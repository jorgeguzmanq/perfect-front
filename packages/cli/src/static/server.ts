import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/**
 * Servidor estatico seguro del CLI (solo node:http). Sirve una carpeta por GET/HEAD,
 * enlazado a 127.0.0.1, sin listado de directorios y sin exponer dotfiles,
 * `node_modules` ni `.perfect-front/`. Pensado para correr como proceso administrado
 * (`bin.ts`), pero reutilizable en proceso para pruebas.
 */

export const DEFAULT_STATIC_PORT = 5500;
const PORT_TRIES = 50;
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface StaticHandlerOptions {
  /** Carpeta a servir. */
  root: string;
  /**
   * Fallback (desactivado por defecto): pagina .html relativa que se sirve para GET de
   * rutas sin extension que no existen (SPA). Nunca para archivos con extension.
   */
  fallback?: string | null;
  /** Recibe una linea por solicitud rechazada (403/404 inesperado/405). */
  onDenied?: (line: string) => void;
}

const sameFs = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Segmento prohibido de servir: dotfiles/dotdirs y node_modules. */
const blockedSegment = (s: string): boolean => s.startsWith(".") || sameFs(s, "node_modules");

/** `child` esta dentro de `parent` (o es igual), comparando por segmentos. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

type Resolved = { ok: true; file: string; redirect: boolean } | { ok: false; status: 400 | 403 | 404 };

/** Resuelve un pathname de URL a un archivo regular dentro de la raiz real. */
export async function resolveStaticPath(realRoot: string, urlPath: string): Promise<Resolved> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { ok: false, status: 400 };
  const segs = decoded.split("/").filter((s) => s !== "");
  for (const s of segs) {
    if (s === ".." || s === "." || s.includes(":")) return { ok: false, status: 403 };
    if (blockedSegment(s)) return { ok: false, status: 404 };
  }
  const candidate = path.join(realRoot, ...segs);
  let real: string;
  let redirect = false;
  try {
    real = await fs.promises.realpath(candidate);
    let st = await fs.promises.stat(real);
    if (st.isDirectory()) {
      // Sin barra final: redireccion (los enlaces relativos de la pagina dependen de ella).
      redirect = !decoded.endsWith("/") && segs.length > 0;
      real = await fs.promises.realpath(path.join(real, "index.html"));
      st = await fs.promises.stat(real);
    }
    if (!st.isFile()) return { ok: false, status: 404 };
  } catch {
    return { ok: false, status: 404 };
  }
  // Symlinks / junctions: el destino real debe seguir dentro de la raiz y fuera de zonas bloqueadas.
  if (!isInside(realRoot, real)) return { ok: false, status: 403 };
  if (path.relative(realRoot, real).split(path.sep).some(blockedSegment)) return { ok: false, status: 404 };
  return { ok: true, file: real, redirect };
}

export function createStaticHandler(options: StaticHandlerOptions): http.RequestListener {
  const realRoot = fs.realpathSync(options.root);
  const fallback = options.fallback ?? null;
  const deny = (line: string): void => options.onDenied?.(line);

  return (req, res) => {
    void (async () => {
      const send = (status: number, text: string, extra: http.OutgoingHttpHeaders = {}): void => {
        res.writeHead(status, {
          "content-type": "text/plain; charset=utf-8",
          "content-length": Buffer.byteLength(text),
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
          ...extra,
        });
        res.end(req.method === "HEAD" ? undefined : text);
      };
      const method = req.method ?? "";
      if (method !== "GET" && method !== "HEAD") {
        deny(`405 ${method.slice(0, 16)}`);
        return send(405, "Metodo no permitido", { allow: "GET, HEAD" });
      }
      // Contra DNS rebinding: solo hosts loopback.
      const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
      if (!ALLOWED_HOSTS.has(host)) {
        deny("403 host");
        return send(403, "Host no permitido");
      }
      const raw = req.url ?? "";
      if (!raw.startsWith("/") || raw.startsWith("//")) return send(400, "Solicitud invalida");
      let pathname: string;
      try {
        pathname = new URL(raw, "http://127.0.0.1").pathname;
      } catch {
        return send(400, "Solicitud invalida");
      }
      // `new URL` ya colapsa `/../`; se valida igual el pathname crudo (incluye `..%2f` tras decodificar).
      const rawPath = raw.split(/[?#]/, 1)[0] ?? "/";
      let r = await resolveStaticPath(realRoot, rawPath);
      if (!r.ok && r.status === 404 && fallback && method === "GET" && path.extname(pathname) === "") {
        r = await resolveStaticPath(realRoot, "/" + fallback);
      }
      if (!r.ok) {
        if (r.status !== 404) deny(`${r.status} ${pathname.slice(0, 120)}`);
        return send(r.status, r.status === 404 ? "No encontrado" : r.status === 403 ? "Prohibido" : "Solicitud invalida");
      }
      if (r.redirect) {
        const q = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
        return send(301, "", { location: rawPath + "/" + q });
      }
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(r.file);
      } catch {
        return send(404, "No encontrado");
      }
      res.writeHead(200, {
        "content-type": mimeFor(r.file),
        "content-length": st.size,
        "x-content-type-options": "nosniff",
        "cache-control": "no-cache",
      });
      if (method === "HEAD") return void res.end();
      const stream = fs.createReadStream(r.file);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Error interno");
    });
  };
}

export interface RunningStaticServer {
  server: http.Server;
  port: number;
  host: "127.0.0.1";
  close: () => Promise<void>;
}

function listenOn(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(e);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Arranca en 127.0.0.1 con el puerto preferido (5500 por defecto) o el siguiente libre;
 * `preferredPort: 0` pide uno efimero.
 */
export async function startStaticServer(options: StaticHandlerOptions & { preferredPort?: number }): Promise<RunningStaticServer> {
  const preferred = options.preferredPort ?? DEFAULT_STATIC_PORT;
  const server = http.createServer(createStaticHandler(options));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  let port = -1;
  for (let i = 0; i < (preferred === 0 ? 1 : PORT_TRIES); i++) {
    const candidate = preferred === 0 ? 0 : preferred + i;
    if (candidate > 65535) break;
    try {
      port = await listenOn(server, candidate);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" && code !== "EACCES") throw e;
    }
  }
  if (port < 0) {
    server.close();
    throw new Error(`No hay puerto libre desde ${preferred}`);
  }
  return {
    server,
    port,
    host: "127.0.0.1",
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
