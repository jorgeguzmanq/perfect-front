import fs from "node:fs";
import path from "node:path";
import { PerfectFrontError } from "@perfect-front/shared";

export interface SpawnSpec {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

export interface ResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

const SAFE_ARG = /^[A-Za-z0-9_@.:/\\=,+ -]*$/;
const UNSAFE_PATH = /["%!\r\n]/;

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Busca `command` en PATH (nunca en cwd) probando extensiones; prefiere .exe sobre .cmd. */
export function findOnWindowsPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const exts = [".exe", ".com", ".cmd", ".bat"];
  const hasExt = exts.includes(path.extname(command).toLowerCase());
  const dirs = command.includes("\\") || command.includes("/") ? [""] : (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    const base = dir ? path.join(dir, command) : command;
    for (const ext of hasExt ? [""] : exts) {
      const candidate = base + ext;
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function quoteForCmd(arg: string): string {
  if (!SAFE_ARG.test(arg)) {
    throw new PerfectFrontError("invalid_request", "Argumento con caracteres no permitidos para un shim de Windows");
  }
  if (!arg.includes(" ")) return arg === "" ? '""' : arg;
  if (arg.endsWith("\\")) throw new PerfectFrontError("invalid_request", "Argumento invalido para un shim de Windows");
  return `"${arg}"`;
}

/**
 * Convierte (command, args) en algo ejecutable sin shell interpolado.
 * En Windows los shims .cmd (npm/pnpm/yarn) no pueden lanzarse directo (EINVAL desde Node 20.12),
 * asi que se invoca cmd.exe con una linea construida solo con argumentos validados por lista blanca.
 */
export function resolveSpawn(command: string, args: string[], options: ResolveOptions = {}): SpawnSpec {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== "win32") return { file: command, args, windowsVerbatimArguments: false };

  const found = findOnWindowsPath(command, env);
  if (!found) throw new PerfectFrontError("process_error", `Comando no encontrado: ${command}`);
  const ext = path.extname(found).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return { file: found, args, windowsVerbatimArguments: false };

  if (UNSAFE_PATH.test(found)) throw new PerfectFrontError("invalid_request", "Ruta de comando no permitida");
  const line = [`"${found}"`, ...args.map(quoteForCmd)].join(" ");
  return {
    file: env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
