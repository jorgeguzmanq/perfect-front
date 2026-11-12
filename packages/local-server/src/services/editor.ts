import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PerfectFrontError } from "@perfect-front/shared";
import { z } from "zod";
import type { ProjectRegistry } from "../registry";

export const OpenInEditorRequestSchema = z
  .object({
    file: z.string().min(1).max(1024),
    line: z.number().int().min(1).max(10_000_000).optional(),
    column: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();
export type OpenInEditorRequest = z.infer<typeof OpenInEditorRequestSchema>;

/** Ejecuta `file` con `args` sin shell. Inyectable en tests. */
export type ExecFileFn = (file: string, args: string[]) => Promise<void>;

/** `code` no esta instalado / no esta en el PATH. */
export class EditorNotFoundError extends Error {
  readonly code = "editor_not_found";
  constructor() {
    super("No se encontro el editor: el comando `code` (VS Code) no esta en el PATH");
    this.name = "EditorNotFoundError";
  }
}

const defaultExecFile: ExecFileFn = (file, args) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, args, { windowsHide: true, timeout: 10_000, shell: false }, (err) => (err ? reject(err) : resolve()));
  });

/**
 * Comando del editor. En Windows `code` es `code.cmd`, que no se puede lanzar sin shell: se usa el
 * `Code.exe` que vive junto a `bin/code.cmd` (acepta `-g archivo:linea:col`).
 */
export function resolveEditorCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return "code";
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    if (fs.existsSync(path.join(dir, "code.cmd"))) {
      const exe = path.join(dir, "..", "Code.exe");
      if (fs.existsSync(exe)) return path.resolve(exe);
    }
    const direct = path.join(dir, "code.exe");
    if (fs.existsSync(direct)) return direct;
  }
  return null;
}

export interface EditorServiceOptions {
  execFile?: ExecFileFn;
  /** Comando a ejecutar; `null` = editor no disponible. Por defecto `resolveEditorCommand()` (o `code` si hay execFile inyectado). */
  resolveCommand?: () => string | null;
}

export class EditorService {
  private readonly exec: ExecFileFn;
  private readonly resolveCommand: () => string | null;

  constructor(
    private readonly registry: ProjectRegistry,
    options: EditorServiceOptions = {},
  ) {
    this.exec = options.execFile ?? defaultExecFile;
    this.resolveCommand = options.resolveCommand ?? (options.execFile ? () => "code" : () => resolveEditorCommand());
  }

  /** Ruta absoluta real de `file` si es un archivo existente DENTRO de la raiz del proyecto; si no, lanza. */
  private async resolveInside(root: string, file: string): Promise<string> {
    if (file.includes("\0")) throw new PerfectFrontError("invalid_request", "Ruta invalida");
    const realRoot = await fsp.realpath(root).catch(() => null);
    if (!realRoot) throw new PerfectFrontError("not_found", "La raiz del proyecto ya no existe");
    const candidate = path.resolve(realRoot, file);
    const real = await fsp.realpath(candidate).catch(() => null);
    const inside = (p: string): boolean => {
      const rel = path.relative(realRoot, p);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    // Fuera de la raiz (traversal, absoluta ajena o symlink de escape): mismo error que "no existe".
    if (!inside(candidate) || (real !== null && !inside(real))) throw new PerfectFrontError("invalid_request", "La ruta queda fuera del proyecto");
    if (real === null || !(await fsp.stat(real)).isFile()) throw new PerfectFrontError("not_found", "El archivo no existe");
    return real;
  }

  async open(projectId: string, input: OpenInEditorRequest): Promise<{ file: string; line: number | null; column: number | null }> {
    const rec = this.registry.get(projectId);
    const abs = await this.resolveInside(rec.root, input.file);
    const target = `${abs}${input.line !== undefined ? `:${input.line}${input.column !== undefined ? `:${input.column}` : ""}` : ""}`;
    const command = this.resolveCommand();
    if (!command) throw new EditorNotFoundError();
    try {
      await this.exec(command, ["-g", target]);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new EditorNotFoundError();
      throw new PerfectFrontError("process_error", "No se pudo abrir el editor");
    }
    return { file: path.relative(rec.root, abs).replace(/\\/g, "/"), line: input.line ?? null, column: input.column ?? null };
  }
}
