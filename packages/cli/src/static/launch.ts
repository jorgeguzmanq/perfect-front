import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Target } from "../process";

/** Lanzamiento del servidor estatico como hijo administrado (node + loader tsx sobre `bin.ts`). */
export function staticTarget(root: string, projectDir: string, port: number, opts: { fallback?: string | undefined; page?: string | null | undefined } = {}): Target {
  const entry = fileURLToPath(new URL("./bin.ts", import.meta.url));
  let loader = "tsx";
  try {
    loader = import.meta.resolve("tsx");
  } catch {
    /* se resuelve desde cwd */
  }
  const args = ["--import", loader, entry, "--root", path.resolve(projectDir), "--port", String(port)];
  if (opts.fallback) args.push("--fallback", opts.fallback);
  if (opts.page) args.push("--page", opts.page); // el proceso anuncia la URL de esa pagina
  // url null: nada ajeno en un puerto se confunde con este servidor; la URL real la anuncia el proceso.
  return { root, plan: { command: process.execPath, args, cwd: path.resolve(projectDir) }, url: null };
}

/** URL de la pagina elegida sobre la URL base del servidor estatico. */
export function pageUrl(base: string | null, entry: string | null): string | null {
  if (!base) return null;
  if (!entry) return base;
  return new URL("/" + entry.split("/").map(encodeURIComponent).join("/"), base).toString();
}
