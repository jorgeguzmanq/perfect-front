import crypto from "node:crypto";
import os from "node:os";
import { EXTENSION_ID_RE } from "@perfect-front/shared";

/** Token aleatorio de 256 bits, apto para cabeceras. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Comparación en tiempo constante: se comparan hashes de longitud fija. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer[ \t]+([^\s]+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** `host` es el valor de la cabecera Host (`nombre[:puerto]`). */
export function isAllowedHost(host: string | undefined, port: number | null): boolean {
  if (!host) return false;
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
  if (!isLoopbackHostname(url.hostname)) return false;
  // Defensa contra DNS rebinding: el puerto debe ser el del servidor.
  return port === null || url.port === String(port);
}

export type OriginKind = "none" | "loopback" | "extension";

/**
 * Sin Origin (CLI, curl): "none". Loopback http(s) o una extensión autorizada
 * (oficial o de desarrollo): permitido. Cualquier otro (incluido "null"): null.
 */
export function classifyOrigin(origin: string | undefined, extensionOrigins: ReadonlySet<string>): OriginKind | null {
  if (origin === undefined) return "none";
  if (extensionOrigins.has(origin)) return "extension";
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHostname(url.hostname)) return "loopback";
  return null;
}

export const originOf = (extensionId: string): string => `chrome-extension://${extensionId}`;

/** Valida IDs de extensión (EXTENSION_ID_RE); uno inválido lanza error en lugar de ignorarse. */
export function parseExtensionIds(ids: readonly string[] | string | undefined): string[] {
  const list = typeof ids === "string" ? ids.split(/[\s,]+/) : [...(ids ?? [])];
  const out: string[] = [];
  for (const raw of list) {
    const id = raw.trim();
    if (id === "") continue;
    if (!EXTENSION_ID_RE.test(id)) throw new Error(`ID de extensión inválido: se esperan 32 letras a-p (recibido "${id.slice(0, 40)}")`);
    out.push(id);
  }
  return out;
}

/** Ventana fija; suficiente para un servidor local de un solo usuario. */
export class RateLimiter {
  private windowStart = 0;
  private count = 0;
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** Registra un evento; false si excede el límite. */
  hit(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.max;
  }
  /** Sin registrar: ¿ya está excedido? */
  exceeded(): boolean {
    return this.now() - this.windowStart < this.windowMs && this.count > this.max;
  }
}

/** Oculta tokens y rutas absolutas en texto destinado a logs. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  out = out.replace(/(access_token|token)=[^&\s"']+/gi, "$1=[redacted]");
  const home = os.homedir();
  if (home) out = out.split(home).join("~");
  out = out.replace(/[A-Za-z]:\\[^\s"'<>|*?]+/g, "<path>");
  out = out.replace(/(?<![\w:/])\/(?:home|Users|root|var|tmp|etc|opt|mnt)\/[^\s"'<>|*?]+/g, "<path>");
  return out;
}
