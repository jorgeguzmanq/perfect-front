import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createCommentStorage, isInside, PF_DIR, type CommentStorage } from "@perfect-front/comment-storage";
import { findRoot } from "@perfect-front/project-detector";
import { COMMENT_STATUSES, PerfectFrontError, toErrorData, type VisualComment } from "@perfect-front/shared";

/**
 * Subcomandos que operan DIRECTO sobre `<proyecto>/.perfect-front` (sin servidor local ni navegador):
 * list, show, move, edit, status, claim, resolve, ignore, reopen, export. Contrato para agentes en AGENTS.md.
 */

export const COMMENT_COMMANDS = ["list", "show", "move", "edit", "status", "claim", "resolve", "ignore", "reopen", "export"] as const;
type CommentCommand = (typeof COMMENT_COMMANDS)[number];

/** Codigos de salida de estos subcomandos (los generales viven en `EXIT` de run.ts; los valores no se solapan). */
export const COMMENT_EXIT = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  PROJECT: 3,
  /** El ID (o la coleccion destino) no existe. */
  NOT_FOUND: 6,
  /** Revision obsoleta (--expect-updated-at) o transicion no permitida desde el estado actual. */
  CONFLICT: 7,
  /** Datos ilegibles/invalidos o error de almacenamiento. */
  DATA: 8,
} as const;

export interface CommentIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

/** Error con codigo de salida explicito (proyecto no encontrado, revision obsoleta, id ambiguo...). */
class CommentCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: number,
  ) {
    super(message);
    this.name = "CommentCliError";
  }
}

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  cwd: { type: "string" },
  "state-dir": { type: "string" },
  status: { type: "string" },
  collection: { type: "string" },
  q: { type: "string" },
  to: { type: "string" },
  comment: { type: "string" },
  summary: { type: "string" },
  files: { type: "string" },
  verification: { type: "string", multiple: true },
  commit: { type: "string" },
  by: { type: "string" },
  "expect-updated-at": { type: "string" },
  rev: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
} as const;

const FOREIGN_OPTIONS = {
  url: { type: "string" },
  command: { type: "string" },
  port: { type: "string" },
  page: { type: "string" },
  fallback: { type: "string" },
  "server-port": { type: "string" },
  lines: { type: "string", short: "n" },
} as const;

/** Devuelve el subcomando de comentarios si `argv` lo es (`status` solo si lleva id: sin el, es el estado del servidor). */
export function detectCommentCommand(argv: string[]): CommentCommand | null {
  let positionals: string[];
  try {
    // Se declaran tambien las opciones con valor del resto del CLI para que su valor no cuente como posicional.
    ({ positionals } = parseArgs({ args: argv, allowPositionals: true, strict: false, options: { ...OPTIONS, ...FOREIGN_OPTIONS } }));
  } catch {
    return null;
  }
  const [cmd, ...rest] = positionals;
  if (!cmd || !(COMMENT_COMMANDS as readonly string[]).includes(cmd)) return null;
  if (cmd === "status" && rest.length < 2) return null; // `status` a secas = estado del servidor
  return cmd as CommentCommand;
}

export const COMMENTS_HELP = `Comentarios visuales por CLI (operan sobre <proyecto>/.perfect-front, sin servidor ni navegador)

  perfect-front list [--status pending|in_progress|resolved|ignored|archived|all] [--collection c] [--q texto] [--json]
  perfect-front show <id> [--json]
  perfect-front claim <id>                         pending -> in_progress
  perfect-front resolve <id> --summary "..." [--files a,b] [--verification "..."]... [--commit sha] [--by agent|human]
  perfect-front edit <id> --comment "..."
  perfect-front move <id...> --to <coleccion>
  perfect-front status <id> pending|in_progress|ignored|archived
  perfect-front ignore <id>
  perfect-front reopen <id>
  perfect-front export [--format md] [--status s] [--collection c] [--out archivo.md]   (--out dentro de .perfect-front)

Comunes: --cwd <dir>, --json. <id> acepta un prefijo unico (p. ej. pf_01K9ZQ3).
Bloqueo optimista en edit/move/resolve/ignore/reopen/claim/status: --expect-updated-at <iso> (alias --rev).
Codigos de salida: 0 ok, 2 uso/validacion, 3 proyecto/.perfect-front no encontrado, 6 id no encontrado,
7 conflicto/revision obsoleta, 8 datos/almacenamiento, 1 interno. Detalle: packages/cli/AGENTS.md
`;

// --- Utilidades -------------------------------------------------------------------

const usage = (message: string): CommentCliError => new CommentCliError("invalid_request", message, COMMENT_EXIT.USAGE);

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function trunc(s: string, max: number): string {
  const t = oneLine(s);
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 3)) + "...";
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Raiz del proyecto: `findRoot` y, si ahi no hay `.perfect-front`, el ancestro mas cercano que la tenga. */
function locateRoot(cwd: string): string {
  let root: string | null;
  try {
    root = findRoot(cwd).root;
  } catch {
    root = null;
  }
  if (root && isDir(path.join(root, PF_DIR))) return root;
  for (let d = path.resolve(cwd); ; ) {
    if (isDir(path.join(d, PF_DIR))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new CommentCliError(
    "project_not_found",
    root ? `No hay carpeta ${PF_DIR} en el proyecto (aun no hay comentarios)` : "No se encontro el proyecto (sin .perfect-front ni package.json)",
    COMMENT_EXIT.PROJECT,
  );
}

export function commentExitCode(err: unknown): number {
  if (err instanceof CommentCliError) return err.exit;
  if (err instanceof PerfectFrontError) {
    switch (err.code) {
      case "invalid_request":
      case "invalid_id":
      case "invalid_collection":
      case "payload_too_large":
        return COMMENT_EXIT.USAGE;
      case "not_found":
        return COMMENT_EXIT.NOT_FOUND;
      case "conflict":
        return COMMENT_EXIT.CONFLICT;
      case "invalid_data":
      case "unsupported_version":
      case "storage_error":
        return COMMENT_EXIT.DATA;
    }
  }
  return COMMENT_EXIT.INTERNAL;
}

function shortId(id: string): string {
  return id.slice(0, 17);
}

const ID_CHARS = /^[0-9A-Z]*$/;

/** Acepta ID completo o prefijo unico (sin distinguir mayusculas; `pf_` opcional). */
async function resolveId(storage: CommentStorage, input: string): Promise<string> {
  const raw = input.trim();
  const body = raw.replace(/^pf_/i, "").toUpperCase();
  if (raw.length === 0 || !ID_CHARS.test(body)) throw new CommentCliError("invalid_id", `ID invalido: "${trunc(raw, 40)}"`, COMMENT_EXIT.USAGE);
  const prefix = `pf_${body}`;
  if (prefix.length === 29) return prefix;
  const { comments } = await storage.listComments({});
  const hits = comments.filter((c) => c.id.startsWith(prefix));
  if (hits.length === 0) throw new CommentCliError("not_found", `Comentario no encontrado: ${prefix}`, COMMENT_EXIT.NOT_FOUND);
  if (hits.length > 1) {
    throw new CommentCliError(
      "ambiguous_id",
      `Prefijo ambiguo "${prefix}": coincide con ${hits.length} comentarios (${hits.slice(0, 5).map((c) => shortId(c.id)).join(", ")}${hits.length > 5 ? ", ..." : ""})`,
      COMMENT_EXIT.USAGE,
    );
  }
  return hits[0]!.id;
}

/** Bloqueo optimista: falla si `updatedAt` cambio respecto a lo que el llamador leyo. */
async function checkRevision(storage: CommentStorage, id: string, expect: string | undefined): Promise<VisualComment> {
  const current = await storage.getComment(id);
  if (expect !== undefined) {
    const a = Date.parse(expect);
    const b = Date.parse(current.updatedAt);
    if (Number.isNaN(a)) throw usage("--expect-updated-at debe ser una fecha ISO 8601");
    if (a !== b) {
      throw new CommentCliError(
        "stale_revision",
        `Revision obsoleta: el comentario cambio (updatedAt actual ${current.updatedAt}, esperado ${expect}). Vuelve a leerlo con show.`,
        COMMENT_EXIT.CONFLICT,
      );
    }
  }
  return current;
}

function summarize(c: VisualComment) {
  return {
    id: c.id,
    shortId: shortId(c.id),
    status: c.status,
    collection: c.collection,
    scope: c.scope,
    route: c.location.route,
    url: c.location.url,
    title: c.location.title,
    selector: c.location.selector,
    text: c.comment,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolvedAt: c.resolution?.resolvedAt ?? null,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// --- Ejecucion ------------------------------------------------------------------

export async function runCommentCommand(command: CommentCommand, argv: string[], io: CommentIo): Promise<number> {
  const jsonRequested = argv.includes("--json");
  let json = jsonRequested;
  const out = (s: string): void => io.stdout(s.endsWith("\n") ? s : s + "\n");
  const emit = (data: Record<string, unknown>, human: string): void => {
    if (json) out(JSON.stringify({ ok: true, ...data }));
    else out(human);
  };

  try {
    let values;
    let positionals: string[];
    try {
      ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: OPTIONS }));
    } catch (err) {
      throw usage((err as Error).message.split("\n")[0] ?? "Argumentos invalidos");
    }
    json = values.json === true;
    if (values.help) return out(COMMENTS_HELP), COMMENT_EXIT.OK;
    const args = positionals.slice(1); // sin el nombre del comando
    const cwd = values.cwd ? path.resolve(io.cwd, values.cwd) : io.cwd;
    const expect = values["expect-updated-at"] ?? values.rev;
    if (values["expect-updated-at"] !== undefined && values.rev !== undefined && values.rev !== values["expect-updated-at"]) {
      throw usage("--expect-updated-at y --rev no coinciden");
    }

    const root = locateRoot(cwd);
    const pfDir = path.join(root, PF_DIR);
    const storage = await createCommentStorage(root);

    const needOneId = (): string => {
      if (args.length !== 1) throw usage(`${command} requiere exactamente un <id>`);
      return args[0]!;
    };
    const noExtra = (): void => {
      if (args.length > 0) throw usage(`${command} no acepta argumentos posicionales`);
    };
    const done = (c: VisualComment, human: string): number => {
      emit({ command, comment: c, summary: summarize(c) }, human);
      return COMMENT_EXIT.OK;
    };
    const where = (c: VisualComment): string => `${c.collection}/${c.status}`;

    switch (command) {
      case "list": {
        noExtra();
        const st = values.status ?? "pending";
        if (st !== "all" && !(COMMENT_STATUSES as readonly string[]).includes(st)) {
          throw usage(`--status invalido: ${st} (pending|in_progress|resolved|ignored|archived|all)`);
        }
        const query: Record<string, string> = {};
        if (st !== "all") query.status = st;
        if (values.collection !== undefined) query.collection = values.collection;
        if (values.q !== undefined) query.q = values.q;
        const { comments, errors } = await storage.listComments(query);
        const items = comments.map(summarize);
        if (json) {
          out(JSON.stringify({ ok: true, command, root, status: st, count: items.length, comments: items, errors }));
          return COMMENT_EXIT.OK;
        }
        if (items.length === 0) out(`Sin comentarios (${st}).`);
        else {
          out(`${pad("ID", 17)}  ${pad("ESTADO", 11)}  ${pad("RUTA / SELECTOR", 38)}  COMENTARIO`);
          for (const i of items) {
            const loc = trunc(i.selector ? `${i.route} ${i.selector}` : i.route, 38);
            out(`${pad(i.shortId, 17)}  ${pad(i.status, 11)}  ${pad(loc, 38)}  ${trunc(i.text, 60)}`);
          }
        }
        if (errors.length > 0) {
          io.stderr(`Aviso: ${errors.length} archivo(s) ilegible(s) omitido(s): ${errors.map((e) => `${e.collection}/${e.file}`).join(", ")}\n`);
        }
        return COMMENT_EXIT.OK;
      }

      case "show": {
        const id = await resolveId(storage, needOneId());
        const c = await storage.getComment(id);
        const attachments = c.attachments.map((p) => {
          const abs = path.join(pfDir, ...p.split("/"));
          return { path: p, absolutePath: abs, exists: fs.existsSync(abs) };
        });
        if (json) {
          out(JSON.stringify({ ok: true, command, root, pfDir, comment: c, attachments }));
          return COMMENT_EXIT.OK;
        }
        const l = c.location;
        const lines = [
          `${c.id}  [${c.status}]  coleccion: ${c.collection}  alcance: ${c.scope}`,
          `Creado: ${c.createdAt}  Actualizado: ${c.updatedAt}`,
          "",
          "Comentario:",
          c.comment,
          "",
          `Ruta: ${l.route}`,
          `URL: ${l.url}`,
          `Titulo: ${l.title ?? "-"}`,
          `Selector: ${l.selector ?? "-"}`,
          ...(l.selectorCandidates.length ? ["Selectores candidatos:", ...l.selectorCandidates.map((s) => `  - ${s}`)] : []),
          `Texto del elemento: ${l.text === null ? "-" : trunc(l.text, 300)}`,
          ...(l.componentHint ? [`Componente: ${l.componentHint}`] : []),
          `Viewport: ${c.viewport.width}x${c.viewport.height} dpr ${c.viewport.devicePixelRatio} scroll ${c.viewport.scrollX},${c.viewport.scrollY}`,
          `Rect: ${c.elementRect ? `x ${c.elementRect.x} y ${c.elementRect.y} ${c.elementRect.width}x${c.elementRect.height}` : "-"}`,
          `Adjuntos (relativos a ${PF_DIR}): ${attachments.length ? attachments.map((a) => a.path + (a.exists ? "" : " (falta)")).join(", ") : "-"}`,
          ...(l.html ? ["HTML (texto):", l.html.length > 2000 ? l.html.slice(0, 2000) + "\n... (truncado; usa --json para el HTML completo)" : l.html] : []),
          ...(c.resolution
            ? [
                "Resolucion:",
                `  ${c.resolution.resolvedAt} por ${c.resolution.resolvedBy ?? "-"}${c.resolution.commit ? ` commit ${c.resolution.commit}` : ""}`,
                `  ${c.resolution.summary}`,
                ...(c.resolution.filesChanged.length ? [`  Archivos: ${c.resolution.filesChanged.join(", ")}`] : []),
                ...c.resolution.verification.map((v) => `  Verificacion: ${v}`),
              ]
            : []),
        ];
        out(lines.join("\n"));
        return COMMENT_EXIT.OK;
      }

      case "claim": {
        const id = await resolveId(storage, needOneId());
        const cur = await checkRevision(storage, id, expect);
        if (cur.status !== "pending") {
          throw new CommentCliError("conflict", `Solo se puede tomar un comentario pending (estado actual: ${cur.status})`, COMMENT_EXIT.CONFLICT);
        }
        const c = await storage.updateComment(id, { status: "in_progress" });
        return done(c, `Tomado ${shortId(c.id)} (${where(c)})`);
      }

      case "edit": {
        const id = await resolveId(storage, needOneId());
        if (values.comment === undefined) throw usage("edit requiere --comment \"texto\"");
        await checkRevision(storage, id, expect);
        const c = await storage.updateComment(id, { comment: values.comment });
        return done(c, `Editado ${shortId(c.id)}`);
      }

      case "move": {
        if (args.length === 0) throw usage("move requiere al menos un <id>");
        if (!values.to) throw usage("move requiere --to <coleccion>");
        if (expect !== undefined && args.length > 1) throw usage("--expect-updated-at solo se admite con un unico <id>");
        const ids: string[] = [];
        for (const a of args) ids.push(await resolveId(storage, a));
        const results: Array<{ id: string; ok: boolean; comment?: VisualComment; error?: { code: string; message: string } }> = [];
        for (const id of ids) {
          try {
            await checkRevision(storage, id, expect);
            results.push({ id, ok: true, comment: await storage.moveComment(id, values.to) });
          } catch (e) {
            const d = e instanceof CommentCliError ? { code: e.code, message: e.message } : toErrorData(e);
            results.push({ id, ok: false, error: { code: d.code, message: d.message } });
            (results[results.length - 1] as { exit?: number }).exit = commentExitCode(e);
          }
        }
        const failed = results.filter((r) => !r.ok);
        const exits = results.map((r) => (r as { exit?: number }).exit);
        const clean = results.map(({ id, ok, comment, error }) => ({ id, ok, ...(comment ? { comment, summary: summarize(comment) } : {}), ...(error ? { error } : {}) }));
        if (failed.length === 0) {
          emit({ command, to: values.to, results: clean }, results.map((r) => `Movido ${shortId(r.id)} -> ${r.comment!.collection}`).join("\n"));
          return COMMENT_EXIT.OK;
        }
        const first = failed[0]!;
        if (json) out(JSON.stringify({ ok: false, error: first.error, results: clean }));
        else {
          for (const r of results) {
            if (r.ok) out(`Movido ${shortId(r.id)} -> ${r.comment!.collection}`);
            else io.stderr(`Error ${shortId(r.id)}: ${r.error!.message}\n`);
          }
        }
        return exits.find((x) => x !== undefined) ?? COMMENT_EXIT.INTERNAL;
      }

      case "resolve": {
        const id = await resolveId(storage, needOneId());
        if (!values.summary) throw usage("resolve requiere --summary \"...\"");
        if (values.by !== undefined && values.by !== "agent" && values.by !== "human") throw usage("--by debe ser agent o human");
        const cur = await checkRevision(storage, id, expect);
        if (cur.status === "resolved" || cur.status === "archived") {
          throw new CommentCliError("conflict", `El comentario ya esta ${cur.status}; usa reopen antes de volver a resolver`, COMMENT_EXIT.CONFLICT);
        }
        const files = values.files?.split(",").map((s) => s.trim()).filter(Boolean);
        const c = await storage.resolveComment(id, {
          summary: values.summary,
          resolvedBy: values.by ?? null,
          ...(files ? { filesChanged: files } : {}),
          ...(values.verification ? { verification: values.verification } : {}),
          ...(values.commit !== undefined ? { commit: values.commit } : {}),
        });
        return done(c, `Resuelto ${shortId(c.id)} -> ${c.collection}`);
      }

      case "ignore": {
        const id = await resolveId(storage, needOneId());
        await checkRevision(storage, id, expect);
        const c = await storage.ignoreComment(id);
        return done(c, `Ignorado ${shortId(c.id)}`);
      }

      case "reopen": {
        const id = await resolveId(storage, needOneId());
        await checkRevision(storage, id, expect);
        const c = await storage.reopenComment(id);
        return done(c, `Reabierto ${shortId(c.id)} (${where(c)})`);
      }

      case "status": {
        if (args.length !== 2) throw usage("status requiere <id> <pending|in_progress|ignored|archived>");
        const target = args[1]!;
        if (!["pending", "in_progress", "ignored", "archived"].includes(target)) {
          throw usage(target === "resolved" ? "Para resolver usa `resolve <id> --summary ...`" : `Estado invalido: ${target}`);
        }
        const id = await resolveId(storage, args[0]!);
        const cur = await checkRevision(storage, id, expect);
        let c: VisualComment = cur;
        if (cur.status !== target) {
          if (target === "pending") c = await storage.reopenComment(id);
          else if (target === "ignored") c = await storage.ignoreComment(id);
          else if (target === "archived") c = await storage.archiveComment(id);
          else {
            if (cur.status === "resolved" || cur.status === "archived") {
              throw new CommentCliError("conflict", `No se pasa de ${cur.status} a in_progress: usa reopen primero`, COMMENT_EXIT.CONFLICT);
            }
            c = await storage.updateComment(id, { status: "in_progress" });
          }
        }
        return done(c, `${shortId(c.id)} -> ${c.status} (${c.collection})`);
      }

      case "export": {
        noExtra();
        const format = values.format ?? "md";
        if (format !== "md") throw usage("--format solo admite md");
        const st = values.status ?? "all";
        if (st !== "all" && !(COMMENT_STATUSES as readonly string[]).includes(st)) throw usage(`--status invalido: ${st}`);
        const query: Record<string, string> = {};
        if (st !== "all") query.status = st;
        if (values.collection !== undefined) query.collection = values.collection;
        const r = await storage.exportMarkdown(query);
        if (values.out === undefined) {
          if (json) out(JSON.stringify({ ok: true, command, format, count: r.count, markdown: r.markdown, errors: r.errors }));
          else io.stdout(r.markdown.endsWith("\n") ? r.markdown : r.markdown + "\n");
          return COMMENT_EXIT.OK;
        }
        const file = safeExportPath(pfDir, values.out);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // El directorio real (tras symlinks/junctions) tambien debe seguir dentro de .perfect-front.
        if (!isInside(fs.realpathSync(pfDir), fs.realpathSync(path.dirname(file)))) {
          throw usage("--out apunta fuera de .perfect-front");
        }
        fs.writeFileSync(file, r.markdown, "utf8");
        const rel = path.relative(pfDir, file).split(path.sep).join("/");
        emit({ command, format, count: r.count, file: rel, errors: r.errors }, `Exportados ${r.count} comentario(s) a ${PF_DIR}/${rel}`);
        return COMMENT_EXIT.OK;
      }
    }
  } catch (err) {
    const data = err instanceof CommentCliError ? { code: err.code, message: err.message } : toErrorData(err);
    if (json || jsonRequested) out(JSON.stringify({ ok: false, error: data }));
    else io.stderr(`Error: ${data.message}\n`);
    return commentExitCode(err);
  }
}

/** `--out` relativo a .perfect-front (o absoluto dentro): solo `.md`, sin salir de la carpeta ni tocar comentarios/config. */
export function safeExportPath(pfDir: string, out: string): string {
  if (out.includes("\0")) throw usage("--out invalido");
  const file = path.resolve(pfDir, out);
  if (!isInside(pfDir, file) || file === path.resolve(pfDir)) throw usage("--out debe quedar dentro de .perfect-front");
  if (path.extname(file).toLowerCase() !== ".md") throw usage("--out debe ser un archivo .md");
  return file;
}
