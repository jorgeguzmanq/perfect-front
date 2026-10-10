/**
 * Proveedor del script de la capa para el proxy. El bundle se construye una vez
 * (en cuanto se pide el proveedor, para que la primera pagina no espere) y se cachea.
 * `PF_OVERLAY_NO_CACHE=1` (o `noCache`) reconstruye en cada peticion: desarrollo del overlay.
 * El import de `@perfect-front/overlay/build` es perezoso: esbuild no se carga si no hay proxy.
 */
export function overlayScriptProvider(opts: { noCache?: boolean; env?: NodeJS.ProcessEnv; build?: () => Promise<string> } = {}): () => Promise<string> {
  const env = opts.env ?? process.env;
  const noCache = opts.noCache === true || env.PF_OVERLAY_NO_CACHE === "1";
  const build = opts.build ?? (async (): Promise<string> => (await import("@perfect-front/overlay/build")).buildOverlayBundle());
  let cached: Promise<string> | null = null;
  const load = (): Promise<string> => {
    if (noCache) return build();
    cached ??= build().catch((e: unknown) => {
      cached = null; // un fallo no queda cacheado: se reintenta en la siguiente peticion
      throw e;
    });
    return cached;
  };
  if (!noCache) load().catch(() => undefined); // construccion anticipada
  return load;
}
