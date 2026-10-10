import { startProxy, type ProxyHandle } from "@perfect-front/proxy";
import type { DiscoveryInfo } from "../discovery";

/** Destino HTTP del proxy a partir de una URL; null si no es http (el proxy solo habla HTTP plano). */
export function proxyTargetOf(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return { host, port: u.port ? Number(u.port) : 80 };
  } catch {
    return null;
  }
}

/** Misma ruta/consulta de `pageUrl` pero bajo el origen del proxy. */
export function swapOrigin(pageUrl: string, proxyBase: string): string {
  const p = new URL(pageUrl);
  return new URL(p.pathname + p.search + p.hash, proxyBase).toString();
}

export interface ProxyHostOptions {
  target: { host: string; port: number };
  projectId: string;
  discovery: DiscoveryInfo;
  getOverlayScript: () => Promise<string>;
  /** Puerto preferido; ocupado = el proxy usa el siguiente libre (7788+). */
  listenPort?: number;
  log?: (line: string) => void;
}

export interface ProxyHost {
  /** Origen del proxy (http://127.0.0.1:<puerto>). */
  readonly url: string;
  readonly port: number;
  /** El servidor local cambio (otro puerto/token): reinicia el proxy en el mismo puerto. */
  rebind(discovery: DiscoveryInfo): Promise<void>;
  close(): Promise<void>;
}

const baseUrlOf = (d: DiscoveryInfo): string => `http://${d.host.includes(":") ? `[${d.host}]` : d.host}:${d.port}`;

/** Envuelve `startProxy` con el token de CLI del servidor local (solo viaja proxy -> servidor local). */
export async function startProxyHost(o: ProxyHostOptions): Promise<ProxyHost> {
  const launch = (d: DiscoveryInfo, listenPort?: number): Promise<ProxyHandle> =>
    startProxy({
      target: o.target,
      projectId: o.projectId,
      localServer: { baseUrl: baseUrlOf(d), token: d.cliToken },
      getOverlayScript: o.getOverlayScript,
      ...(listenPort !== undefined ? { listenPort } : {}),
      ...(o.log ? { log: o.log } : {}),
    });
  let handle = await launch(o.discovery, o.listenPort);
  let closed = false;
  return {
    get url() {
      return handle.url;
    },
    get port() {
      return handle.port;
    },
    async rebind(d) {
      if (closed) return;
      const port = handle.port;
      await handle.close();
      handle = await launch(d, port).catch(() => launch(d));
    },
    async close() {
      closed = true;
      await handle.close();
    },
  };
}
