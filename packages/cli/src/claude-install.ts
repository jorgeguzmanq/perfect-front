import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { COMMENT_EXIT } from "./comments";

/**
 * `perfect-front claude [--force] [--home <dir>] [--json]`: instala el skill y los comandos de Claude Code
 * (packages/cli/claude/) en `<home>/.claude`. Enlaza en vez de copiar para que un `git pull` los actualice solo.
 */

export const CLAUDE_HELP = `Instala el skill y los comandos de Perfect Front en Claude Code (~/.claude)

  perfect-front claude [--force] [--home <dir>] [--json]

  Enlaza (no copia) skills/perfect-front y commands/{pf,pf-watch,pf-status}.md desde packages/cli/claude/ en <home>/.claude.
  Es idempotente: lo que ya apunta aqui se deja igual. Lo que existe y no es de este repo se OMITE.
  --force      Respalda lo existente como <nombre>.bak-<fecha> y lo reemplaza
  --home <dir> Directorio "home" cuyo .claude se usa (por defecto el del usuario)
  --json       {"ok":true,"command":"claude","home","claudeDir","force","items":[...],"summary":{...},"warnings":[...]}
En Windows sin permiso de symlink los archivos caen a copia (con aviso); las carpetas usan junction. Codigos: 0 ok, 2 uso, 1 error.
`;

export type ClaudeAction = "linked" | "copied" | "unchanged" | "skipped" | "replaced";

export interface ClaudeItem {
  kind: "skill" | "command";
  name: string;
  source: string;
  target: string;
  action: ClaudeAction;
  /** `linked`/`copied` tras respaldar: ruta del respaldo (action `replaced`). */
  backup?: string;
  /** Como quedo instalado cuando se escribio algo. */
  mode?: "symlink" | "junction" | "copy";
}

export interface ClaudeInstallResult {
  home: string;
  claudeDir: string;
  force: boolean;
  items: ClaudeItem[];
  warnings: string[];
}

export interface ClaudeInstallOptions {
  /** Directorio home; el destino es `<home>/.claude`. */
  home?: string;
  force?: boolean;
  /** Carpeta con `skills/` y `commands/`; por defecto packages/cli/claude. */
  sourceDir?: string;
  now?: () => Date;
}

export function defaultClaudeSource(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "claude");
}

const stamp = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");

const lstatOrNull = (p: string): fs.Stats | null => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

const realOrSelf = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** true si `target` es un enlace que lleva a `source`. */
function linksTo(target: string, source: string): boolean {
  const st = lstatOrNull(target);
  if (!st?.isSymbolicLink()) return false;
  return realOrSelf(target).toLowerCase() === realOrSelf(source).toLowerCase();
}

/** Contenido identico (archivo o carpeta, recursivo): sirve para reconocer una copia nuestra ya instalada. */
function sameContent(a: string, b: string): boolean {
  const sa = lstatOrNull(a);
  const sb = lstatOrNull(b);
  if (!sa || !sb) return false;
  if (sa.isDirectory() !== sb.isDirectory()) return false;
  if (!sa.isDirectory()) return sa.isFile() && sb.isFile() && fs.readFileSync(a).equals(fs.readFileSync(b));
  const na = fs.readdirSync(a).sort();
  const nb = fs.readdirSync(b).sort();
  return na.length === nb.length && na.every((n, i) => n === nb[i] && sameContent(path.join(a, n), path.join(b, n)));
}

function uniqueBackup(target: string, when: Date): string {
  const base = `${target}.bak-${stamp(when)}`;
  let candidate = base;
  for (let i = 2; lstatOrNull(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}

/** Enlaza `source` en `target`; si el SO lo niega, copia. Devuelve como quedo. */
function place(source: string, target: string, isDir: boolean, warnings: string[]): "symlink" | "junction" | "copy" {
  try {
    if (isDir && process.platform === "win32") {
      fs.symlinkSync(source, target, "junction");
      return "junction";
    }
    fs.symlinkSync(source, target, isDir ? "dir" : "file");
    return "symlink";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS" && code !== "UNKNOWN") throw e;
    fs.cpSync(source, target, { recursive: true });
    warnings.push(`Sin permiso de symlink: ${target} se COPIO (no se actualizara con git pull; repite \`perfect-front claude --force\` tras actualizar el repo o activa el modo desarrollador de Windows).`);
    return "copy";
  }
}

export function installClaude(options: ClaudeInstallOptions = {}): ClaudeInstallResult {
  const home = path.resolve(options.home ?? os.homedir());
  const claudeDir = path.join(home, ".claude");
  const sourceDir = options.sourceDir ?? defaultClaudeSource();
  const force = options.force === true;
  const now = options.now ?? (() => new Date());
  const warnings: string[] = [];
  const items: ClaudeItem[] = [];

  const pieces: Array<{ kind: ClaudeItem["kind"]; name: string }> = [];
  for (const [kind, folder] of [["skill", "skills"], ["command", "commands"]] as const) {
    const dir = path.join(sourceDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) pieces.push({ kind, name });
  }

  for (const { kind, name } of pieces) {
    const folder = kind === "skill" ? "skills" : "commands";
    const source = path.join(sourceDir, folder, name);
    const target = path.join(claudeDir, folder, name);
    const isDir = fs.statSync(source).isDirectory();
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const prev = lstatOrNull(target);
    let backup: string | undefined;
    if (prev) {
      if (linksTo(target, source) || (!prev.isSymbolicLink() && sameContent(source, target))) {
        items.push({ kind, name, source, target, action: "unchanged" });
        continue;
      }
      if (!force) {
        items.push({ kind, name, source, target, action: "skipped" });
        continue;
      }
      backup = uniqueBackup(target, now());
      fs.renameSync(target, backup);
    }
    const mode = place(source, target, isDir, warnings);
    items.push({ kind, name, source, target, action: backup ? "replaced" : mode === "copy" ? "copied" : "linked", mode, ...(backup ? { backup } : {}) });
  }

  return { home, claudeDir, force, items, warnings };
}

export function summarize(items: readonly ClaudeItem[]): Record<ClaudeAction, number> {
  const s: Record<ClaudeAction, number> = { linked: 0, copied: 0, unchanged: 0, skipped: 0, replaced: 0 };
  for (const i of items) s[i.action] += 1;
  return s;
}

export function detectClaudeCommand(argv: string[]): boolean {
  try {
    const { positionals } = parseArgs({ args: argv, allowPositionals: true, strict: false, options: { home: { type: "string" }, cwd: { type: "string" }, project: { type: "string" } } });
    return positionals[0] === "claude";
  } catch {
    return false;
  }
}

const LABEL: Record<ClaudeAction, string> = { linked: "enlazado", copied: "copiado", unchanged: "ya estaba", skipped: "OMITIDO", replaced: "reemplazado" };

export async function runClaudeCommand(argv: string[], io: { stdout: (s: string) => void; stderr: (s: string) => void; home?: string; now?: () => Date }): Promise<number> {
  const json = argv.includes("--json");
  const out = (s: string): void => io.stdout(s.endsWith("\n") ? s : `${s}\n`);
  let values: { force?: boolean; home?: string; help?: boolean; json?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { force: { type: "boolean" }, home: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) out(JSON.stringify({ ok: false, error: { code: "invalid_request", message } }));
    else io.stderr(`${message}\nUso: perfect-front claude [--force] [--home <dir>] [--json]\n`);
    return COMMENT_EXIT.USAGE;
  }
  if (values.help) {
    out(CLAUDE_HELP);
    return COMMENT_EXIT.OK;
  }
  if (positionals.length > 1) {
    const message = `Argumentos sobrantes: ${positionals.slice(1).join(" ")}`;
    if (json) out(JSON.stringify({ ok: false, error: { code: "invalid_request", message } }));
    else io.stderr(`${message}\n`);
    return COMMENT_EXIT.USAGE;
  }
  try {
    const home = values.home ?? io.home;
    const result = installClaude({ ...(home ? { home } : {}), force: values.force === true, ...(io.now ? { now: io.now } : {}) });
    const summary = summarize(result.items);
    if (json) {
      out(JSON.stringify({ ok: true, command: "claude", ...result, summary }));
      return COMMENT_EXIT.OK;
    }
    out("");
    for (const i of result.items) {
      const extra = i.action === "skipped" ? " — ya existe y no es de este repo (--force lo respalda y lo reemplaza)" : i.backup ? ` (respaldo: ${i.backup})` : "";
      out(`  ${LABEL[i.action].padEnd(11)} ${i.target}${extra}`);
    }
    for (const w of result.warnings) io.stderr(`Aviso: ${w}\n`);
    out(summary.skipped > 0 ? "\n  Algunas piezas se omitieron: revisa arriba." : "\n  Listo. Abre una sesion nueva de Claude Code para que cargue /pf, /pf-watch, /pf-status y el skill perfect-front.");
    return COMMENT_EXIT.OK;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) out(JSON.stringify({ ok: false, error: { code: "internal_error", message } }));
    else io.stderr(`No se pudo instalar: ${message}\n`);
    return COMMENT_EXIT.INTERNAL;
  }
}
