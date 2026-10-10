import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInside } from "@perfect-front/comment-storage";
import { isAllowedHost } from "./security";

/** Build del dashboard (`pnpm --filter @perfect-front/dashboard build`), relativo a este paquete. */
export function defaultDashboardDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/dashboard/dist");
}

export const MISSING_BUILD_MESSAGE =
  "Perfect Front: el dashboard no está compilado.\nEjecuta: pnpm --filter @perfect-front/dashboard build\nLa API en /api/* sigue disponible.\n";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** CSP del dashboard: sin scripts ni conexiones externas, sin iframes ajenos, imágenes solo propias/blob. */
export const DASHBOARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export type StaticResult =
  | { kind: "file"; status: 200; body: Uint8Array; contentType: string; isIndex: boolean }
  | { kind: "missing-build" }
  | { kind: "bad-path" }
  | { kind: "not-found" };

/**
 * Decodifica y valida la ruta pedida. Rechaza (null) traversal, separadores de Windows,
 * bytes nulos y cualquier segmento que empiece por punto (dotfiles, `.`/`..`).
 */
export function safeSegments(rawPath: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  for (const s of segments) if (s.startsWith(".") || s.includes(":")) return null;
  return segments;
}

async function readIfFile(dirReal: string, segments: string[]): Promise<Uint8Array | null> {
  const target = path.join(dirReal, ...segments);
  if (!isInside(dirReal, target)) return null;
  try {
    // realpath: un enlace simbólico dentro de dist no puede sacar archivos de dist.
    const real = await fs.realpath(target);
    if (!isInside(dirReal, real)) return null;
    const stat = await fs.stat(real);
    if (!stat.isFile()) return null;
    return await fs.readFile(real);
  } catch {
    return null;
  }
}

/** Resuelve un GET/HEAD al build estático, con fallback SPA para rutas del cliente (sin extensión). */
export async function resolveStatic(dir: string, rawPath: string): Promise<StaticResult> {
  let dirReal: string;
  try {
    dirReal = await fs.realpath(dir);
  } catch {
    return { kind: "missing-build" };
  }
  const segments = safeSegments(rawPath);
  if (segments === null) return { kind: "bad-path" };

  if (segments.length > 0) {
    const file = await readIfFile(dirReal, segments);
    if (file) {
      const ext = path.extname(segments[segments.length - 1]!).toLowerCase();
      const contentType = MIME[ext] ?? "application/octet-stream";
      return { kind: "file", status: 200, body: file, contentType, isIndex: segments.length === 1 && segments[0] === "index.html" };
    }
    // Una ruta con extensión es un recurso concreto: no se enmascara con el index.
    if (path.extname(segments[segments.length - 1]!) !== "") return { kind: "not-found" };
  }
  const index = await readIfFile(dirReal, ["index.html"]);
  if (!index) return { kind: "missing-build" };
  return { kind: "file", status: 200, body: index, contentType: MIME[".html"]!, isIndex: true };
}

/**
 * ¿Se puede entregar el token de sesión en el HTML de esta petición?
 *
 * Razonamiento (anti DNS-rebinding y anti CSRF/lectura cross-origin):
 *  - Host debe ser loopback con el puerto propio. Con DNS rebinding el navegador envía
 *    `Host: atacante.com`, que se rechaza; sin Host válido nunca hay token.
 *  - Origin debe faltar (navegación directa o `<script>`/fetch same-origin simple) o ser EXACTAMENTE
 *    el origen de este servidor. Otra app en `localhost:3000` (p. ej. la app revisada) es "loopback"
 *    para la API, pero no debe poder leer el token con `fetch` CORS: su Origin difiere y no se inyecta.
 *  - Si el navegador envía `Sec-Fetch-Site`, debe ser `same-origin` o `none` (navegación del usuario);
 *    `same-site`/`cross-site` se rechazan (cubre `<iframe>`, `<script src>` o `<link>` ajenos).
 *  - Además la respuesta lleva CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY` y `no-store`.
 */
export function canInjectToken(
  req: { url: string; header(name: string): string | undefined },
  port: number | null,
): boolean {
  const url = new URL(req.url);
  if (!isAllowedHost(url.host, port)) return false;
  const headerHost = req.header("host");
  if (headerHost !== undefined && !isAllowedHost(headerHost, port)) return false;
  const origin = req.header("origin");
  if (origin !== undefined && origin !== url.origin) return false;
  const site = req.header("sec-fetch-site");
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  return true;
}

const META_RE = /<meta\s+name=["']pf-token["'][^>]*>/i;

/** Inserta el token en `<meta name="pf-token">`. El token es base64url: seguro en un atributo. */
export function injectToken(html: string, token: string): string {
  const meta = `<meta name="pf-token" content="${token}">`;
  if (META_RE.test(html)) return html.replace(META_RE, meta);
  return html.includes("</head>") ? html.replace("</head>", `${meta}</head>`) : meta + html;
}
