import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DetectionError, detectProject, type DetectOptions } from "../src/index";

const fx = (n: string): string => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", n);
const snapshot = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

function failure(fn: () => unknown): DetectionError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DetectionError) return e;
    throw e;
  }
  throw new Error("no lanzó");
}

const detect = (n: string, extra: Partial<DetectOptions> = {}) => detectProject({ cwd: fx(n), ...extra });

describe("Next.js", () => {
  it("App Router con npm: script dev, puerto 3000, sin shell", () => {
    const r = detect("next-app");
    expect(r.kind).toBe("dev-server");
    expect(r.framework).toEqual({ runtime: "next", ui: "react" });
    expect(r.plan).toMatchObject({ command: "npm", args: ["run", "dev"], source: "script" });
    expect(r.port).toBe(3000);
    expect(r.url).toBe("http://localhost:3000");
    expect(r.reasons.some((x) => x.step === "framework" && /Next\.js/.test(x.message))).toBe(true);
  });

  it("puerto del script (-p) y gestor pnpm por packageManager", () => {
    const r = detect("next-custom-port");
    expect(r.port).toBe(4100);
    expect(r.packageManager).toMatchObject({ name: "pnpm", version: "9.0.0" });
    expect(r.plan).toMatchObject({ command: "pnpm", args: ["run", "dev"] });
  });

  it("PORT=... dentro del script", () => {
    expect(detect("next-env-port").url).toBe("http://localhost:4500");
  });

  it("variable PORT del entorno: solo si se pasa explícitamente (la detección no lee process.env)", () => {
    const before = process.env.PORT;
    process.env.PORT = "7777";
    try {
      expect(detect("next-app").port).toBe(3000);
    } finally {
      if (before === undefined) delete process.env.PORT;
      else process.env.PORT = before;
    }
    expect(detect("next-app", { env: { PORT: "4321" } }).url).toBe("http://localhost:4321");
    expect(detect("next-app", { env: { PORT: "abc" } }).port).toBe(3000);
    // el flag del script manda sobre PORT
    expect(detect("next-custom-port", { env: { PORT: "4321" } }).port).toBe(4100);
  });

  it("sin script dev se ejecuta el binario local con el gestor (pnpm exec next dev)", () => {
    const r = detect("next-no-script");
    expect(r.plan).toMatchObject({ command: "pnpm", args: ["exec", "next", "dev"], source: "script" });
    expect(r.framework).toEqual({ runtime: "next", ui: "react" });
  });

  it("Pages Router con yarn por lockfile", () => {
    const r = detect("next-pages-router");
    expect(r.packageManager.name).toBe("yarn");
    expect(r.plan).toMatchObject({ command: "yarn", args: ["run", "dev"] });
  });

  it("--port se propaga como flag (con -- en npm) sin --strictPort", () => {
    const r = detect("next-app", { overrides: { port: 3456 } });
    expect(r.url).toBe("http://localhost:3456");
    expect(r.plan.args).toEqual(["run", "dev", "--", "--port", "3456"]);
    const bare = detect("next-no-script", { overrides: { port: 3456 } });
    expect(bare.plan.args).toEqual(["exec", "next", "dev", "--port", "3456"]);
  });
});

describe("Angular", () => {
  it("un proyecto con yarn: script start, puerto 4200", () => {
    const r = detect("angular-app");
    expect(r.framework).toEqual({ runtime: "angular", ui: "angular" });
    expect(r.plan).toMatchObject({ command: "yarn", args: ["run", "start"], source: "script" });
    expect(r.port).toBe(4200);
    expect(r.url).toBe("http://localhost:4200");
    expect(r.reasons.some((x) => /Proyecto Angular: demo/.test(x.message))).toBe(true);
  });

  it("sin script ng serve: npx ng serve <proyecto>", () => {
    const r = detect("angular-no-script");
    expect(r.plan).toMatchObject({ command: "npx", args: ["ng", "serve", "demo"] });
  });

  it("puerto de angular.json y del script (el script manda)", () => {
    expect(detect("angular-port").port).toBe(4300);
    expect(detect("angular-script-port").port).toBe(4400);
  });

  it("workspace con varios proyectos sin predeterminado: ambiguo y accionable", () => {
    const e = failure(() => detect("angular-multi"));
    expect(e.reason).toBe("command_ambiguous");
    expect(e.message).toMatch(/admin, shop/);
    expect(e.message).toMatch(/--command "ng serve admin"/);
  });

  it("defaultProject de angular.json resuelve la ambigüedad y aporta su puerto", () => {
    const r = detect("angular-multi-default");
    expect(r.port).toBe(4301);
    expect(r.reasons.some((x) => /admin \(predeterminado/.test(x.message))).toBe(true);
  });

  it("el script que nombra el proyecto resuelve la ambigüedad", () => {
    const r = detect("angular-multi-named");
    expect(r.plan.args).toEqual(["run", "start"]);
    expect(r.reasons.some((x) => /shop \(nombrado/.test(x.message))).toBe(true);
  });

  it("las librerías (sin serve) no cuentan como proyecto servible", () => {
    expect(detect("angular-library-only").plan).toMatchObject({ args: ["run", "start"] });
  });

  it("--port se propaga a ng serve", () => {
    expect(detect("angular-app", { overrides: { port: 4999 } }).plan.args).toEqual(["run", "start", "--port", "4999"]);
  });

  it("workspace pnpm con una app Angular anidada (desde la raíz)", () => {
    const r = detect("workspace-nested-angular");
    expect(r.projectDir).toBe(path.join(fx("workspace-nested-angular"), "apps", "web"));
    expect(r.packageManager.name).toBe("pnpm");
    expect(r.framework).toEqual({ runtime: "angular", ui: "angular" });
    expect(r.plan).toMatchObject({ command: "pnpm", cwd: r.projectDir });
  });

  it("monorrepo con apps de distinto framework: ambiguo con la lista", () => {
    const e = failure(() => detect("workspace-mixed"));
    expect(e.reason).toBe("command_ambiguous");
    expect(e.message).toMatch(/apps\/admin \(Angular\)/);
    expect(e.message).toMatch(/apps\/site \(Next\.js\)/);
    // entrando en una app se resuelve
    expect(detectProject({ cwd: path.join(fx("workspace-mixed"), "apps", "site") }).framework).toEqual({ runtime: "next", ui: "react" });
  });
});

describe("prioridad entre frameworks", () => {
  it("Vite > Next > Angular", () => {
    expect(detect("vite-and-next").framework).toMatchObject({ bundler: "vite" });
    expect(detect("next-and-angular").framework).toEqual({ runtime: "next", ui: "react" });
  });

  it("una dependencia vite suelta no gana a Next", () => {
    const r = detect("next-weak-vite");
    expect(r.framework).toEqual({ runtime: "next", ui: "react" });
    expect(r.plan.args).toEqual(["run", "dev"]);
  });

  it("la configuración explícita (project.json) gana a la detección de framework", () => {
    const r = detect("explicit-config");
    expect(r.plan.source).toBe("config");
  });
});

describe("--url y --command ganan siempre (atajo universal)", () => {
  it("--url: servidor existente, sin proceso, aunque el framework sea otro", () => {
    for (const n of ["next-app", "angular-app", "vite-vue-npm", "unsupported", "angular-multi", "workspace-mixed"]) {
      const r = detect(n, { overrides: { url: "http://localhost:5555/ruta" } });
      expect(r.kind, n).toBe("external");
      expect(r.url).toBe("http://localhost:5555/ruta");
      expect(r.port).toBe(5555);
      expect(r.plan).toMatchObject({ source: "external", command: "external", args: [] });
    }
  });

  it("--url informa el framework solo como dato", () => {
    expect(detect("next-app", { overrides: { url: "http://localhost:3000" } }).framework).toEqual({ runtime: "next", ui: "react" });
    expect(detect("unsupported", { overrides: { url: "http://localhost:3000" } }).framework).toBeNull();
  });

  it("--url inválido es un error de uso", () => {
    const e = failure(() => detect("next-app", { overrides: { url: "ftp://x" } }));
    expect(e.reason).toBe("invalid_command");
  });

  it("--url gana a project.json aunque tenga command", () => {
    const r = detect("explicit-config", { overrides: { url: "http://localhost:9999" } });
    expect(r.kind).toBe("external");
  });

  it("--command en un proyecto de framework no compatible: se ejecuta tal cual", () => {
    const r = detect("unsupported", { overrides: { command: "node server.js --port 4000" } });
    expect(r.kind).toBe("dev-server");
    expect(r.plan).toMatchObject({ command: "node", args: ["server.js", "--port", "4000"], source: "override" });
    expect(r.port).toBe(4000);
  });

  it("--command gana sobre Next y Angular (y sobre la ambigüedad)", () => {
    const n = detect("next-app", { overrides: { command: "npx next dev -p 3999" } });
    expect(n.plan).toMatchObject({ command: "npx", args: ["next", "dev", "-p", "3999"], source: "override" });
    expect(n.port).toBe(3999);
    const a = detect("angular-multi", { overrides: { command: "npx ng serve shop --port 4010" } });
    expect(a.plan).toMatchObject({ command: "npx", args: ["ng", "serve", "shop", "--port", "4010"] });
    expect(a.port).toBe(4010);
    const m = detect("workspace-mixed", { overrides: { command: "pnpm --filter site dev" } });
    expect(m.plan.source).toBe("override");
  });

  it("--command + --url: ejecuta el comando y espera esa URL", () => {
    const r = detect("next-app", { overrides: { command: "node dev.js", url: "http://localhost:8080/" } });
    expect(r.kind).toBe("dev-server");
    expect(r.url).toBe("http://localhost:8080/");
    expect(r.port).toBe(8080);
  });

  it("sin package.json (ni raíz): --url y --command funcionan; sin ellos, error", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pf-bare-"));
    try {
      const u = detectProject({ cwd: tmp, overrides: { url: "http://localhost:3000" } });
      expect(u.kind).toBe("external");
      expect(u.root).toBe(tmp);
      const c = detectProject({ cwd: tmp, overrides: { command: "python -m http.server 8000", port: 8000 } });
      expect(c.plan).toMatchObject({ command: "python", args: ["-m", "http.server", "8000"], cwd: tmp });
      expect(c.url).toBe("http://localhost:8000");
      expect(failure(() => detectProject({ cwd: tmp })).reason).toBe("root_not_found");
      // package.json ilegible: --url sigue funcionando
      writeFileSync(path.join(tmp, "package.json"), "{ no es json");
      expect(detectProject({ cwd: tmp, overrides: { url: "http://localhost:3000" } }).kind).toBe("external");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("el error de framework no compatible es accionable", () => {
    const e = failure(() => detect("unsupported"));
    expect(e.reason).toBe("framework_unknown");
    expect(e.message).toMatch(/--url http:\/\/localhost:PUERTO/);
    expect(e.message).toMatch(/--command/);
    expect(e.message).toMatch(/Next\.js/);
  });
});

describe("pureza y determinismo de los frameworks nuevos", () => {
  it("mismo resultado, sin escribir en disco", () => {
    for (const n of ["next-app", "next-custom-port", "next-no-script", "angular-app", "angular-multi-default", "workspace-nested-angular"]) {
      const before = snapshot(fx(n));
      const a = detect(n);
      const b = detect(n);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(snapshot(fx(n))).toEqual(before);
    }
  });
});
