import { randomUUID } from "node:crypto";
import {
  copyFile,
  constants as fsConstants,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { PerfectFrontError } from "@perfect-front/shared";
import {
  PF_DIR,
  STORAGE_LIMITS,
  assertPlainFileName,
  isInside,
  parseCollectionName,
  parseCommentId,
} from "./paths";

const COMMENT_FILE_RE = /^(pf_[0-9A-HJKMNP-TV-Z]{5,40})\.json$/;
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

function code(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

/** Traduce errores de Node a errores seguros (sin rutas absolutas en el mensaje). */
export async function io<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof PerfectFrontError) throw e;
    const c = code(e);
    if (c === "ENOENT") throw new PerfectFrontError("not_found", "Archivo o carpeta no encontrado");
    throw new PerfectFrontError("storage_error", `Error de almacenamiento${c ? ` (${c})` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      // Windows devuelve EPERM/EBUSY transitorios si otro proceso toca el destino.
      if (i < 10 && TRANSIENT.has(code(e) ?? "")) {
        await sleep(5 * (i + 1));
        continue;
      }
      throw e;
    }
  }
}

export interface ListedEntry {
  /** Nombre de archivo tal cual está en disco. */
  file: string;
  /** ID derivado del nombre, o null si el nombre no es un ID válido. */
  id: string | null;
}

/**
 * Operaciones de archivos bajo `<root>/.perfect-front`. No conoce reglas de negocio.
 * Toda ruta pasa por `guard`: realpath dentro de la raíz y sin symlinks en el camino.
 */
export class FsRepository {
  readonly pfDir: string;
  private constructor(readonly rootReal: string) {
    this.pfDir = path.join(rootReal, PF_DIR);
  }

  static async open(root: string): Promise<FsRepository> {
    if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
      throw new PerfectFrontError("invalid_request", "Raíz inválida");
    }
    const real = await io(realpath(path.resolve(root)));
    const st = await io(stat(real));
    if (!st.isDirectory()) throw new PerfectFrontError("invalid_request", "La raíz no es una carpeta");
    return new FsRepository(real);
  }

  // --- Seguridad -------------------------------------------------------------

  /** Base real de .perfect-front, verificando que no escape de la raíz. */
  private async pfReal(): Promise<string> {
    let real: string;
    try {
      real = await realpath(this.pfDir);
    } catch (e) {
      if (code(e) === "ENOENT") throw new PerfectFrontError("not_found", ".perfect-front no existe; ejecuta init");
      throw new PerfectFrontError("storage_error", "No se pudo resolver .perfect-front");
    }
    if (!isInside(this.rootReal, real)) {
      throw new PerfectFrontError("invalid_request", ".perfect-front apunta fuera de la raíz");
    }
    return real;
  }

  /** Verifica que `target` (léxicamente bajo pfDir) no pueda escapar de la raíz. */
  async guard(target: string): Promise<void> {
    if (!isInside(this.pfDir, target)) {
      throw new PerfectFrontError("invalid_request", "Ruta fuera de .perfect-front");
    }
    const base = await this.pfReal();
    let cur = target;
    while (cur !== this.pfDir) {
      let st;
      try {
        st = await lstat(cur);
      } catch (e) {
        if (code(e) === "ENOENT" || code(e) === "ENOTDIR") {
          cur = path.dirname(cur);
          continue;
        }
        throw new PerfectFrontError("storage_error", "No se pudo inspeccionar la ruta");
      }
      if (st.isSymbolicLink()) {
        throw new PerfectFrontError("invalid_request", "No se permiten enlaces simbólicos");
      }
      const real = await io(realpath(cur));
      if (!isInside(base, real)) {
        throw new PerfectFrontError("invalid_request", "Ruta fuera de .perfect-front");
      }
      return;
    }
  }

  // --- Rutas -----------------------------------------------------------------

  collectionDir(collection: string): string {
    return path.join(this.pfDir, "comments", parseCollectionName(collection));
  }
  commentFile(collection: string, id: string): string {
    return path.join(this.collectionDir(collection), `${parseCommentId(id)}.json`);
  }
  get configFile(): string {
    return path.join(this.pfDir, "project.json");
  }
  attachmentFile(name: string): string {
    return path.join(this.pfDir, "attachments", assertPlainFileName(name));
  }
  exportFile(name: string): string {
    return path.join(this.pfDir, "exports", assertPlainFileName(name));
  }
  private get tmpDir(): string {
    return path.join(this.pfDir, ".tmp");
  }

  // --- Carpetas --------------------------------------------------------------

  /** Crea `.perfect-front/` y subcarpetas base. */
  async ensureLayout(): Promise<void> {
    await io(mkdir(this.pfDir, { recursive: true }));
    for (const sub of ["comments", "attachments", ".tmp"]) {
      const dir = path.join(this.pfDir, sub);
      await this.guard(dir);
      await io(mkdir(dir, { recursive: true }));
    }
  }

  async ensureExportsDir(): Promise<void> {
    const dir = path.join(this.pfDir, "exports");
    await this.guard(dir);
    await io(mkdir(dir, { recursive: true }));
  }

  async ensureCollectionDir(collection: string): Promise<boolean> {
    const dir = this.collectionDir(collection);
    await this.guard(dir);
    const existed = await this.exists(dir);
    await io(mkdir(dir, { recursive: true }));
    await this.guard(dir);
    return !existed;
  }

  async collectionExists(collection: string): Promise<boolean> {
    const dir = this.collectionDir(collection);
    await this.guard(dir);
    try {
      return (await lstat(dir)).isDirectory();
    } catch (e) {
      if (code(e) === "ENOENT") return false;
      throw new PerfectFrontError("storage_error", "No se pudo inspeccionar la colección");
    }
  }

  /** Nombres de colecciones válidas (carpetas reales; ignora symlinks y nombres inválidos). */
  async listCollectionNames(): Promise<string[]> {
    const dir = path.join(this.pfDir, "comments");
    await this.guard(dir);
    const entries = await io(readdir(dir, { withFileTypes: true }));
    return entries
      .filter((e) => e.isDirectory() && parseOk(e.name))
      .map((e) => e.name)
      .sort();
  }

  /** Archivos `.json` de una colección (los que no tienen nombre de ID se devuelven con id null). */
  async listEntries(collection: string): Promise<ListedEntry[]> {
    const dir = this.collectionDir(collection);
    await this.guard(dir);
    const entries = await io(readdir(dir, { withFileTypes: true }));
    const out: ListedEntry[] = [];
    for (const e of entries) {
      if (!e.name.toLowerCase().endsWith(".json")) continue;
      const m = COMMENT_FILE_RE.exec(e.name);
      out.push({ file: e.name, id: m ? m[1]! : null });
    }
    return out.sort((a, b) => (a.file < b.file ? -1 : 1));
  }

  async exists(p: string): Promise<boolean> {
    try {
      await lstat(p);
      return true;
    } catch (e) {
      if (code(e) === "ENOENT" || code(e) === "ENOTDIR") return false;
      throw new PerfectFrontError("storage_error", "No se pudo inspeccionar la ruta");
    }
  }

  /** Colecciones donde existe un archivo para `id` (lo normal es 0 o 1). */
  async locate(id: string, collections: string[]): Promise<string[]> {
    const found: string[] = [];
    for (const c of collections) {
      const file = this.commentFile(c, id);
      await this.guard(file);
      if (await this.exists(file)) found.push(c);
    }
    return found;
  }

  // --- Lectura / escritura ---------------------------------------------------

  async readJson(file: string, maxBytes: number): Promise<unknown> {
    await this.guard(file);
    const st = await io(lstat(file));
    if (st.isSymbolicLink()) throw new PerfectFrontError("invalid_request", "No se permiten enlaces simbólicos");
    if (!st.isFile()) throw new PerfectFrontError("invalid_data", "No es un archivo regular");
    if (st.size > maxBytes) throw new PerfectFrontError("payload_too_large", "Archivo demasiado grande");
    const text = (await io(readFile(file, "utf8"))).replace(/^\uFEFF/, "");
    try {
      return JSON.parse(text);
    } catch {
      throw new PerfectFrontError("invalid_data", "JSON corrupto");
    }
  }

  /**
   * Escribe JSON: temporal en `.tmp/`, relectura y validación, y publicación.
   * `overwrite=false` falla con `conflict` si el destino existe (nunca pisa).
   */
  async writeJson<T>(
    dest: string,
    value: unknown,
    validate: (v: unknown) => T,
    opts: { overwrite: boolean; maxBytes: number },
  ): Promise<T> {
    const text = JSON.stringify(value, null, 2) + "\n";
    return this.writeAtomic(dest, text, opts, (written) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(written);
      } catch {
        throw new PerfectFrontError("invalid_data", "El JSON escrito no es válido");
      }
      return validate(parsed);
    });
  }

  async writeText(dest: string, text: string, opts: { overwrite: boolean; maxBytes: number }): Promise<void> {
    await this.writeAtomic(dest, text, opts, () => undefined);
  }

  async writeBinaryExclusive(dest: string, bytes: Uint8Array, maxBytes: number): Promise<void> {
    if (bytes.byteLength > maxBytes) throw new PerfectFrontError("payload_too_large", "Archivo demasiado grande");
    await this.guard(dest);
    const tmp = await this.newTmp();
    try {
      await io(writeFile(tmp, bytes, { flag: "wx" }));
      await this.publishExclusive(tmp, dest);
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  private async newTmp(): Promise<string> {
    await this.guard(this.tmpDir);
    await io(mkdir(this.tmpDir, { recursive: true }));
    const tmp = path.join(this.tmpDir, `${randomUUID()}.tmp`);
    await this.guard(tmp);
    return tmp;
  }

  private async writeAtomic<T>(
    dest: string,
    text: string,
    opts: { overwrite: boolean; maxBytes: number },
    validate: (written: string) => T,
  ): Promise<T> {
    if (Buffer.byteLength(text, "utf8") > opts.maxBytes) {
      throw new PerfectFrontError("payload_too_large", "Documento demasiado grande");
    }
    await this.guard(dest);
    const tmp = await this.newTmp();
    try {
      await io(writeFile(tmp, text, { flag: "wx", encoding: "utf8" }));
      const result = validate(await io(readFile(tmp, "utf8")));
      if (opts.overwrite) {
        await io(renameRetry(tmp, dest));
      } else {
        await this.publishExclusive(tmp, dest);
      }
      return result;
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /** Publica `tmp` en `dest` sin sobrescribir (hard link; copia exclusiva si el FS no soporta links). */
  private async publishExclusive(tmp: string, dest: string): Promise<void> {
    try {
      await link(tmp, dest);
      return;
    } catch (e) {
      if (code(e) === "EEXIST") throw new PerfectFrontError("conflict", "El destino ya existe");
      if (code(e) === "ENOENT") throw new PerfectFrontError("not_found", "Carpeta de destino no encontrada");
    }
    try {
      await copyFile(tmp, dest, fsConstants.COPYFILE_EXCL);
    } catch (e) {
      if (code(e) === "EEXIST") throw new PerfectFrontError("conflict", "El destino ya existe");
      throw new PerfectFrontError("storage_error", "No se pudo publicar el archivo");
    }
  }

  /** Mueve un archivo con rename (atómico en el mismo volumen). No pisa un destino existente. */
  async moveFile(from: string, to: string): Promise<void> {
    await this.guard(from);
    await this.guard(to);
    if (await this.exists(to)) throw new PerfectFrontError("conflict", "El destino ya existe");
    await io(renameRetry(from, to));
  }

  async remove(file: string): Promise<void> {
    await this.guard(file);
    await rm(file, { force: true }).catch(() => undefined);
  }

  /** Lee un archivo de texto de la raíz (p. ej. .gitignore). Null si no existe. */
  async readRootText(name: string, maxBytes: number): Promise<string | null> {
    const file = path.join(this.rootReal, assertPlainFileName(name));
    let st;
    try {
      st = await lstat(file);
    } catch (e) {
      if (code(e) === "ENOENT") return null;
      throw new PerfectFrontError("storage_error", "No se pudo inspeccionar el archivo");
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      throw new PerfectFrontError("invalid_request", `${name} no es un archivo regular`);
    }
    if (st.size > maxBytes) throw new PerfectFrontError("payload_too_large", `${name} demasiado grande`);
    return io(readFile(file, "utf8"));
  }
}

function parseOk(name: string): boolean {
  try {
    parseCollectionName(name);
    return true;
  } catch {
    return false;
  }
}

export { STORAGE_LIMITS };
