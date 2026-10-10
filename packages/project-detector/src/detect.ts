import path from "node:path";
import { ProjectConfigSchema, zodDetails, type ProjectConfig } from "@perfect-front/shared";
import { splitCommand } from "./command";
import { isFile, readPackageJson, readTextSafe, type PackageJson } from "./fs";
import {
  DetectionError,
  ExecutionPlanSchema,
  type DetectOptions,
  type DetectionResult,
  type PackageManagerName,
  type Reason,
} from "./types";
import { normalizePagePath, scanHtmlPages, type StaticInfo } from "./static";
import {
  DEFAULT_ANGULAR_PORT,
  DEFAULT_NEXT_PORT,
  DEFAULT_VITE_PORT,
  VITE_CONFIGS,
  detectFramework,
  execPlan,
  pickScript,
  portFromScript,
  readAngularWorkspace,
  scriptNamesAngularProject,
  type FrameworkHit,
} from "./frameworks";
import { expandWorkspace, isWorkspaceMember, workspacePatterns } from "./workspace";

const DEFAULT_STATIC_PORT = 5500;
const LOCKFILES: [string, PackageManagerName][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
/** Carpeta de `dir` hacia arriba, de la más cercana a la más lejana. */
function ancestors(dir: string): string[] {
  const out: string[] = [];
  let cur = dir;
  for (;;) {
    out.push(cur);
    const up = path.dirname(cur);
    if (up === cur) return out;
    cur = up;
  }
}

export function findRoot(cwd: string): { root: string; via: "config" | "package" } {
  const chain = ancestors(path.resolve(cwd));
  const withConfig = chain.find((d) => isFile(path.join(d, ".perfect-front", "project.json")));
  if (withConfig) return { root: withConfig, via: "config" };
  const withPkg = chain.find((d) => isFile(path.join(d, "package.json")));
  if (withPkg) return { root: withPkg, via: "package" };
  throw new DetectionError("root_not_found", "No se encontró la raíz del proyecto (sin .perfect-front/project.json ni package.json)");
}

function readConfig(root: string): { config: ProjectConfig | null; file: string | null } {
  const file = path.join(root, ".perfect-front", "project.json");
  const text = readTextSafe(file);
  if (text === null) return { config: null, file: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DetectionError("invalid_config", ".perfect-front/project.json no es JSON válido");
  }
  const parsed = ProjectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DetectionError("invalid_config", ".perfect-front/project.json inválido", zodDetails(parsed.error));
  }
  return { config: parsed.data, file };
}

function pickViteScript(pkg: PackageJson): string {
  if (pkg.scripts.dev !== undefined) return "dev";
  const alt = ["start", "serve"].filter((n) => {
    const s = pkg.scripts[n];
    return s !== undefined && /\bvite\b/.test(s) && !/\b(build|preview)\b/.test(s);
  });
  if (alt.length === 1) return alt[0] as string;
  throw new DetectionError(
    "command_ambiguous",
    alt.length === 0 ? "Proyecto Vite sin script `dev` utilizable" : `Varios scripts candidatos: ${alt.join(", ")}`,
  );
}

function detectPackageManager(dirs: string[]): { name: PackageManagerName; version: string | null; source: string; note?: string } {
  for (const dir of dirs) {
    const pm = readPackageJson(dir)?.packageManager;
    const m = pm ? /^(pnpm|npm|yarn|bun)@([^+\s]+)/.exec(pm) : null;
    if (m) return { name: m[1] as PackageManagerName, version: m[2] as string, source: `packageManager en ${path.basename(dir)}` };
  }
  for (const dir of dirs) {
    const hits = LOCKFILES.filter(([f]) => isFile(path.join(dir, f)));
    const first = hits[0];
    if (first) {
      const names = [...new Set(hits.map(([, n]) => n))];
      const note = names.length > 1 ? `Varios lockfiles (${names.join(", ")}); se usa ${first[1]}` : undefined;
      return { name: first[1], version: null, source: `lockfile ${first[0]}`, ...(note ? { note } : {}) };
    }
  }
  return { name: "npm", version: null, source: "por defecto (sin packageManager ni lockfile)" };
}

function declaredPort(dir: string, scriptText: string | undefined): { port: number; source: string } | null {
  const fromScript = scriptText && /(?:--port[=\s]+|\s-p[=\s]*)(\d{2,5})\b/.exec(scriptText);
  if (fromScript) return { port: Number(fromScript[1]), source: "flag --port del script" };
  for (const f of VITE_CONFIGS) {
    const text = readTextSafe(path.join(dir, f));
    const m = text && /\bserver\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})\b/s.exec(text);
    if (m) return { port: Number(m[1]), source: `server.port en ${f}` };
  }
  return null;
}

const FRAMEWORK_LABEL = { vite: "Vite", next: "Next.js", angular: "Angular" } as const;

function checkPort(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new DetectionError("invalid_command", `Puerto inválido (${label})`);
  return n;
}

function checkUrl(u: string, label: string): string {
  try {
    const p = new URL(u);
    if (p.protocol === "http:" || p.protocol === "https:") return u;
  } catch {
    /* cae al error */
  }
  throw new DetectionError("invalid_command", `URL inválida (${label}): debe ser http(s)`);
}

const relPosix = (from: string, to: string): string => path.relative(from, to).replace(/\\/g, "/");

const encodePage = (p: string): string => p.split("/").map(encodeURIComponent).join("/");

/** Elige la página: override > project.json entry > index.html > única página > sin elección. */
function chooseStaticEntry(
  pages: string[],
  truncated: boolean,
  ov: { page?: string | undefined; choose?: boolean | undefined },
  configEntry: string | undefined,
  add: (step: Reason["step"], message: string) => void,
): StaticInfo {
  const info = (entry: string | null, choice: StaticInfo["choice"]): StaticInfo => ({
    pages,
    entry,
    status: entry ? "chosen" : "needs_choice",
    choice,
    truncated,
  });
  if (ov.page !== undefined) {
    const n = normalizePagePath(ov.page);
    if (!n || !pages.includes(n)) {
      const shown = pages.slice(0, 8).join(", ") + (pages.length > 8 ? ", ..." : "");
      throw new DetectionError("invalid_command", `Página no válida (--page): debe ser una de las candidatas: ${shown}`);
    }
    add("override", `Override --page ${n}`);
    return info(n, "override");
  }
  if (!ov.choose && configEntry !== undefined) {
    const n = normalizePagePath(configEntry);
    if (n && pages.includes(n)) {
      add("config", `Página recordada en project.json: ${n}`);
      return info(n, "config");
    }
    add("config", `La página recordada (${configEntry}) ya no está entre las candidatas; se ignora`);
  }
  if (ov.choose && pages.length > 1) {
    add("override", "--choose: se pide elegir entre las candidatas");
    return info(null, null);
  }
  if (pages.includes("index.html")) {
    add("framework", "index.html en la raíz manda sobre las demás páginas");
    return info("index.html", "index");
  }
  const only = pages[0];
  if (pages.length === 1 && only) {
    add("framework", `Única página: ${only}`);
    return info(only, "single");
  }
  add("framework", `${pages.length} páginas sin index.html: hay que elegir una`);
  return info(null, null);
}

/** Detección pura: solo lee el filesystem; no crea archivos ni procesos. */
export function detectProject(options: DetectOptions): DetectionResult {
  const reasons: Reason[] = [];
  const add = (step: Reason["step"], message: string): void => void reasons.push({ step, message });
  const ov = options.overrides ?? {};
  const cwd = path.resolve(options.cwd);

  let root: string;
  let via: "config" | "package" | "static" | "cwd";
  try {
    ({ root, via } = findRoot(cwd));
  } catch (err) {
    if (!(err instanceof DetectionError) || err.reason !== "root_not_found") throw err;
    // --command y --url son el atajo universal: funcionan en cualquier carpeta, aunque no haya package.json.
    const universal = ov.command !== undefined || ov.url !== undefined;
    if (!universal && scanHtmlPages(cwd).pages.length === 0) throw err;
    root = cwd;
    via = universal ? "cwd" : "static";
  }
  add(
    "root",
    via === "config"
      ? "Raíz por .perfect-front/project.json"
      : via === "package"
        ? "Raíz por package.json más cercano"
        : via === "cwd"
          ? "Raíz: carpeta actual (sin package.json; --command/--url no necesitan proyecto)"
          : "Raíz: carpeta con HTML (sin package.json)",
  );
  const { config, file: configPath } = readConfig(root);
  add("config", config ? "project.json leído; la configuración explícita tiene prioridad" : "Sin project.json: se usa detección");

  const explicitCommand = ov.command ?? config?.command;
  if (ov.command) add("override", "Override --command");
  if (ov.url) add("override", "Override --url");
  if (ov.port !== undefined) add("override", "Override --port");

  // Carpeta inicial: package.json más cercano a cwd sin salir de la raíz.
  const within = ancestors(cwd).filter((d) => !relPosix(root, d).startsWith(".."));
  const startDir = within.find((d) => isFile(path.join(d, "package.json"))) ?? root;
  let projectDir = startDir;

  // --url sin --command: el servidor ya corre; no se arranca nada (atajo universal, sin importar el framework).
  if (ov.url !== undefined && ov.command === undefined) {
    const url = checkUrl(ov.url, "--url");
    let hit: FrameworkHit | null = null;
    let name = path.basename(root);
    try {
      const p = readPackageJson(projectDir);
      hit = detectFramework(projectDir, p);
      name = p?.name ?? name;
    } catch {
      /* package.json ilegible: con --url no hace falta */
    }
    if (hit) add("framework", `${FRAMEWORK_LABEL[hit.kind]} detectado (solo informativo): ${hit.evidence.join(", ")}`);
    const u = new URL(url);
    const port = ov.port !== undefined ? checkPort(ov.port, "--port") : u.port ? Number(u.port) : null;
    add("url", `Servidor existente en ${url}: no se inicia ningún proceso`);
    return {
      root,
      projectDir,
      configPath,
      name: config?.name ?? name,
      kind: "external",
      static: null,
      framework: hit?.info ?? null,
      packageManager: { name: "npm", version: null, source: "no aplica (--url)" },
      plan: ExecutionPlanSchema.parse({ command: "external", args: [], cwd: projectDir, source: "external" }),
      url,
      port,
      reasons,
    };
  }

  let pkg = readPackageJson(projectDir);
  let fw = detectFramework(projectDir, pkg);

  if (!fw) {
    const patterns = workspacePatterns(projectDir);
    if (patterns) {
      const apps = expandWorkspace(projectDir, patterns).flatMap((d) => {
        const p = readPackageJson(d);
        const h = detectFramework(d, p);
        return h ? [{ d, p, h }] : [];
      });
      const only = apps[0];
      if (apps.length === 1 && only) {
        add("workspace", `Workspace: aplicación ${FRAMEWORK_LABEL[only.h.kind]} en ${relPosix(projectDir, only.d)}`);
        projectDir = only.d;
        pkg = only.p;
        fw = only.h;
      } else if (apps.length > 1 && !explicitCommand) {
        throw new DetectionError(
          "command_ambiguous",
          `Varias aplicaciones en el workspace: ${apps.map((a) => `${relPosix(projectDir, a.d)} (${FRAMEWORK_LABEL[a.h.kind]})`).join(", ")}. Entra en una con --cwd <carpeta> o usa --command "..."`,
        );
      }
    }
  }

  add("package", pkg ? `package.json leído (${pkg.name ?? "sin nombre"})` : "Sin package.json en la carpeta");
  if (fw) add("framework", `${FRAMEWORK_LABEL[fw.kind]} detectado: ${fw.evidence.join(", ")}`);
  if (fw?.kind === "vite" && fw.info.ui) add("framework", `Metadata UI: ${fw.info.ui}`);

  if (!fw && !explicitCommand) {
    // Carpeta con HTML propio dentro de otro proyecto sin runner: se sirve esa carpeta, no el ancestro.
    const cwdStatic = via !== "config" && cwd !== startDir && scanHtmlPages(cwd).pages.length > 0;
    const cands = cwdStatic ? [] : ["dev", "start"].filter((n) => pkg?.scripts[n] !== undefined);
    if (cands.length > 1) {
      throw new DetectionError("command_ambiguous", `Scripts en conflicto (${cands.join(", ")}) sin framework compatible`);
    }
    const hasExplicitUrl = ov.url !== undefined || config?.url !== undefined;
    if (cands.length === 0 && !hasExplicitUrl) {
      const dir = cwdStatic ? cwd : startDir;
      const scan = scanHtmlPages(dir);
      if (scan.pages.length > 0) {
        if (cwdStatic && via === "package") root = cwd; // el proyecto estático pasa a ser esta carpeta
        add("framework", `HTML estático: ${scan.pages.length} página(s) candidata(s)${scan.truncated ? " (lista truncada)" : ""}`);
        const st = chooseStaticEntry(scan.pages, scan.truncated, { page: ov.page, choose: ov.choose }, config?.entry, add);
        const port = ov.port !== undefined ? checkPort(ov.port, "--port") : DEFAULT_STATIC_PORT;
        if (ov.port !== undefined) add("port", `Puerto preferido ${port} por override`);
        const url = `http://127.0.0.1:${port}/${st.entry ? encodePage(st.entry) : ""}`;
        add("url", `URL candidata ${url} (el puerto final lo anuncia el servidor estático)`);
        return {
          root,
          projectDir: dir,
          configPath,
          name: config?.name ?? path.basename(root),
          kind: "static",
          static: st,
          framework: null,
          packageManager: { name: "npm", version: null, source: "no aplica (HTML estático)" },
          plan: ExecutionPlanSchema.parse({ command: "static-server", args: [], cwd: dir, source: "static" }),
          url,
          port,
          reasons,
        };
      }
    }
    throw new DetectionError(
      "framework_unknown",
      'Framework no compatible: se soporta Vite, Next.js, Angular y HTML estático. Si ya lo tienes corriendo usa --url http://localhost:PUERTO, o indica cómo arrancarlo con --command "..."',
    );
  }

  // Gestor de paquetes: carpeta de la app y, si es miembro, la raíz del workspace.
  const pmDirs = [projectDir];
  for (const a of ancestors(projectDir).slice(1)) {
    const pats = workspacePatterns(a);
    if (pats && isWorkspaceMember(a, pats, projectDir)) {
      pmDirs.push(a);
      break;
    }
  }
  const pm = detectPackageManager(pmDirs);
  add("package-manager", `${pm.name}${pm.version ? `@${pm.version}` : ""} (${pm.source})`);
  if (pm.note) add("package-manager", pm.note);

  // Comando.
  let command = "";
  let args: string[] = [];
  let source: "override" | "config" | "script";
  let scriptText: string | undefined;
  /** Puerto del proyecto Angular elegido (angular.json). */
  let angularPort: number | null = null;
  /** El plan es `<pm> run <script>` (en npm, los flags extra necesitan `--`). */
  let viaRun = true;
  if (explicitCommand) {
    ({ command, args } = splitCommand(explicitCommand));
    source = ov.command ? "override" : "config";
    add("script", `Comando explícito (${source}): ${explicitCommand}`);
  } else {
    const p = pkg as PackageJson;
    source = "script";
    const run = (name: string): void => {
      scriptText = p.scripts[name];
      command = pm.name;
      args = ["run", name];
      add("script", `Script \`${name}\` ejecutado con ${pm.name} run`);
    };
    const exec = (bin: string, binArgs: string[]): void => {
      ({ command, args } = execPlan(pm.name, bin, binArgs));
      viaRun = false;
      add("script", `Sin script utilizable: se ejecuta \`${[command, ...args].join(" ")}\``);
    };
    if (fw?.kind === "next") {
      if (p.scripts.dev !== undefined) run("dev");
      else {
        const s = pickScript(p, [], /(^|[\s;&|=])next\s+dev(\s|$)/);
        if (s.name) run(s.name);
        else if (s.ambiguous.length > 1) throw new DetectionError("command_ambiguous", `Varios scripts candidatos: ${s.ambiguous.join(", ")}`);
        else exec("next", ["dev"]);
      }
    } else if (fw?.kind === "angular") {
      const s = pickScript(p, ["start", "serve", "dev"], /(^|[\s;&|=])ng\s+(serve|s)(\s|$)/);
      if (s.name) run(s.name);
      else if (s.ambiguous.length > 1) throw new DetectionError("command_ambiguous", `Varios scripts candidatos: ${s.ambiguous.join(", ")}`);
      else exec("ng", ["serve"]);
      // Workspace Angular con varios proyectos: hace falta saber cuál servir.
      const ws = readAngularWorkspace(projectDir);
      const apps = ws?.apps ?? [];
      const named = scriptNamesAngularProject(scriptText, apps);
      const chosen = named ?? ws?.defaultProject ?? (apps.length === 1 ? (apps[0]?.name ?? null) : null);
      if (!chosen && apps.length > 1) {
        const first = apps[0]?.name ?? "app";
        throw new DetectionError(
          "command_ambiguous",
          `angular.json tiene varios proyectos con serve (${apps.map((a) => a.name).join(", ")}) y ninguno es el predeterminado: indica uno con --command "ng serve ${first}"`,
        );
      }
      if (chosen) {
        add("framework", `Proyecto Angular: ${chosen}${named ? " (nombrado en el script)" : ws?.defaultProject === chosen ? " (predeterminado de angular.json)" : " (único con serve)"}`);
        angularPort = apps.find((a) => a.name === chosen)?.port ?? null;
        // Sin script que lo nombre, el CLI de Angular usa el único proyecto o el predeterminado; con exec se hace explícito.
        if (!viaRun && !named) args = [...args, chosen];
      }
    } else {
      run(pickViteScript(p));
    }
  }

  // Puerto y URL.
  const explicitUrl = ov.url !== undefined ? checkUrl(ov.url, "--url") : config?.url;
  let port: number | null = null;
  let url: string;
  if (ov.port !== undefined) {
    port = checkPort(ov.port, "--port");
    add("port", `Puerto ${port} por override`);
  }
  if (explicitUrl) {
    const urlPort = new URL(explicitUrl).port;
    if (port === null && urlPort) port = Number(urlPort);
    url = explicitUrl;
    add("url", `URL explícita (${ov.url !== undefined ? "override" : "config"}): ${url}`);
  } else {
    if (port === null) {
      const text = scriptText ?? explicitCommand;
      let d: { port: number; source: string } | null;
      let fallback = DEFAULT_VITE_PORT;
      let label = "Vite";
      if (fw?.kind === "next") {
        d = portFromScript(text, true);
        const envPort = options.env?.PORT;
        if (!d && envPort !== undefined && /^\d{2,5}$/.test(envPort) && Number(envPort) <= 65535) d = { port: Number(envPort), source: "variable PORT" };
        fallback = DEFAULT_NEXT_PORT;
        label = "Next.js";
      } else if (fw?.kind === "angular") {
        d = portFromScript(text, false) ?? (angularPort !== null ? { port: angularPort, source: "serve.options.port en angular.json" } : null);
        fallback = DEFAULT_ANGULAR_PORT;
        label = "Angular";
      } else if (fw?.kind === "vite") {
        d = declaredPort(projectDir, text);
      } else {
        d = portFromScript(text, false);
        label = "los dev servers genéricos";
      }
      if (d) {
        port = d.port;
        add("port", `Puerto ${port} (${d.source})`);
      } else {
        port = fallback;
        add("port", `Puerto por defecto de ${label} ${port}${fw ? "" : " (el servidor suele anunciar el real)"}`);
      }
    }
    url = `http://localhost:${port}`;
    add("url", `URL candidata ${url}`);
  }
  // Forzar el puerto pedido en el servidor de desarrollo generado.
  if (source === "script" && ov.port !== undefined) {
    const flags = fw?.kind === "next" || fw?.kind === "angular" ? ["--port", String(port)] : ["--port", String(port), "--strictPort"];
    args = [...args, ...(viaRun && pm.name === "npm" ? ["--"] : []), ...flags];
  }

  const plan = ExecutionPlanSchema.parse({ command, args, cwd: projectDir, source });
  return {
    root,
    projectDir,
    configPath,
    name: config?.name ?? pkg?.name ?? path.basename(root),
    kind: "dev-server",
    static: null,
    framework: fw?.info ?? null,
    packageManager: { name: pm.name, version: pm.version, source: pm.source },
    plan,
    url,
    port,
    reasons,
  };
}

/** Texto para `comment status`. */
export function explainDetection(r: DetectionResult): string {
  return r.reasons.map((x) => `[${x.step}] ${x.message}`).join("\n");
}
