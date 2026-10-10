import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DetectionError, detectProject, splitCommand } from "../src/index";

const fx = (n: string): string => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", n);

function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

function failure(fn: () => unknown): DetectionError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DetectionError) return e;
    throw e;
  }
  throw new Error("no lanzó");
}

describe("fixtures", () => {
  it("Vite + React con pnpm", () => {
    const r = detectProject({ cwd: fx("vite-react-pnpm") });
    expect(r.framework).toEqual({ bundler: "vite", ui: "react" });
    expect(r.packageManager).toMatchObject({ name: "pnpm", version: "9.0.0" });
    expect(r.plan).toMatchObject({ command: "pnpm", args: ["run", "dev"], source: "script" });
    expect(r.url).toBe("http://localhost:5173");
  });

  it("Vite + Vue con npm", () => {
    const r = detectProject({ cwd: fx("vite-vue-npm") });
    expect(r.framework).toEqual({ bundler: "vite", ui: "vue" });
    expect(r.plan).toMatchObject({ command: "npm", args: ["run", "dev"] });
    expect(r.url).toBe("http://localhost:5173");
  });

  it("puerto personalizado", () => {
    const r = detectProject({ cwd: fx("vite-custom-port") });
    expect(r.port).toBe(5199);
    expect(r.url).toBe("http://localhost:5199");
    expect(r.plan).toMatchObject({ command: "npm", args: ["run", "dev"] });
  });

  it("workspace con app Vite anidada (desde la raíz y desde la app)", () => {
    const root = detectProject({ cwd: fx("workspace-nested-vite") });
    expect(root.projectDir).toBe(path.join(fx("workspace-nested-vite"), "apps", "web"));
    expect(root.plan).toMatchObject({ command: "pnpm", args: ["run", "dev"], cwd: root.projectDir });
    expect(root.port).toBe(3000);
    const app = detectProject({ cwd: root.projectDir });
    expect(app.packageManager.name).toBe("pnpm");
    expect(app.url).toBe("http://localhost:3000");
  });

  it("proyecto ambiguo", () => {
    expect(failure(() => detectProject({ cwd: fx("ambiguous") })).reason).toBe("command_ambiguous");
  });

  it("proyecto no compatible", () => {
    const e = failure(() => detectProject({ cwd: fx("unsupported") }));
    expect(e.reason).toBe("framework_unknown");
    expect(e.code).toBe("invalid_data");
  });
});

describe("prioridad y overrides", () => {
  it("la configuración explícita gana a la detección", () => {
    const r = detectProject({ cwd: fx("explicit-config") });
    expect(r.url).toBe("http://localhost:4000");
    expect(r.plan).toMatchObject({ command: "npm", args: ["run", "start"], source: "config" });
    expect(r.configPath).not.toBeNull();
  });

  it("los overrides ganan a la configuración", () => {
    const r = detectProject({
      cwd: fx("explicit-config"),
      overrides: { url: "http://localhost:9999", command: "pnpm dev" },
    });
    expect(r.url).toBe("http://localhost:9999");
    expect(r.port).toBe(9999);
    expect(r.plan).toMatchObject({ command: "pnpm", args: ["dev"], source: "override" });
  });

  it("override de puerto se propaga al script", () => {
    const r = detectProject({ cwd: fx("vite-vue-npm"), overrides: { port: 6000 } });
    expect(r.url).toBe("http://localhost:6000");
    expect(r.plan.args).toEqual(["run", "dev", "--", "--port", "6000", "--strictPort"]);
  });

  it("los argumentos conservan espacios sin shell", () => {
    expect(splitCommand(`node "my script.js" --name 'a b' plain`)).toEqual({
      command: "node",
      args: ["my script.js", "--name", "a b", "plain"],
    });
    const r = detectProject({ cwd: fx("vite-vue-npm"), overrides: { command: 'npm run dev -- --host "0.0.0.0 x"' } });
    expect(r.plan.args).toEqual(["run", "dev", "--", "--host", "0.0.0.0 x"]);
  });

  it("rechaza operadores de shell, comillas abiertas y URL inválida", () => {
    expect(() => splitCommand("npm run dev && rm -rf /")).toThrow(DetectionError);
    expect(() => splitCommand('npm "run')).toThrow(DetectionError);
    expect(() => detectProject({ cwd: fx("vite-vue-npm"), overrides: { url: "ftp://x" } })).toThrow(DetectionError);
  });
});

describe("raíz y pureza", () => {
  it("raíz no encontrada", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pf-noroot-"));
    try {
      const e = failure(() => detectProject({ cwd: tmp }));
      expect(e.reason).toBe("root_not_found");
      expect(e.code).toBe("not_found");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("project.json tiene prioridad sobre el package.json más cercano", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pf-prio-"));
    try {
      cpSync(fx("explicit-config"), tmp, { recursive: true });
      const sub = path.join(tmp, "sub");
      mkdirSync(sub);
      writeFileSync(path.join(sub, "package.json"), '{"name":"sub"}');
      expect(detectProject({ cwd: sub }).root).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("es determinista y no escribe en disco", () => {
    for (const n of ["vite-react-pnpm", "vite-custom-port", "workspace-nested-vite", "explicit-config"]) {
      const before = snapshot(fx(n));
      const a = detectProject({ cwd: fx(n) });
      const b = detectProject({ cwd: fx(n) });
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(snapshot(fx(n))).toEqual(before);
    }
  });
});
