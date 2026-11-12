import { annotateJsx } from "./annotate";

/** Solo .jsx/.tsx fuera de node_modules (el `?query` de Vite se ignora). */
export function isAnnotatable(id: string): boolean {
  const file = id.split("?")[0] ?? id;
  return /\.(jsx|tsx)$/.test(file) && !/[\\/]node_modules[\\/]/.test(file);
}

export interface PerfectFrontSourceOptions {
  /** Raiz contra la que se relativizan las rutas (por defecto, la `root` resuelta por Vite). */
  root?: string;
}

/** Plugin Vite: anota el JSX solo en dev (`serve`); en build no hace nada. */
export function perfectFrontSource(options: PerfectFrontSourceOptions = {}) {
  let root = options.root ?? process.cwd();
  let serve = true;
  return {
    name: "perfect-front:source",
    enforce: "pre" as const,
    configResolved(config: { root?: string; command?: string }) {
      if (options.root === undefined && config.root) root = config.root;
      serve = config.command !== "build";
    },
    transform(code: string, id: string): { code: string; map: null } | null {
      if (!serve || !isAnnotatable(id)) return null;
      const out = annotateJsx(code, id.split("?")[0] ?? id, root);
      return out === null ? null : { code: out, map: null };
    },
  };
}
