import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readState } from "../src/process/state";
import { stopManaged } from "../src/process";
import { staticTarget } from "../src/static/launch";
import { EXIT, runCli, type Io } from "../src/run";

// Modo archivo: `perfect-front <archivo.html>` / `--file`. Padre con package.json de workspace (varias apps) para probar que NO sube.
let dirs: string[] = [];
let roots: string[] = [];

function fixture(): { parent: string; dir: string; file: string } {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pf-file-")));
  dirs.push(parent);
  fs.writeFileSync(path.join(parent, "package.json"), JSON.stringify({ name: "mono", private: true, workspaces: ["apps/*"] }));
  for (const a of ["a", "b", "c"]) {
    fs.mkdirSync(path.join(parent, "apps", a), { recursive: true });
    fs.writeFileSync(path.join(parent, "apps", a, "package.json"), JSON.stringify({ name: a, scripts: { dev: "next dev" }, dependencies: { next: "16.0.0" } }));
  }
  const dir = path.join(parent, "plans", "skins");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "explicacion.html"), '<link rel="stylesheet" href="estilo.css"><title>exp</title>');
  fs.writeFileSync(path.join(dir, "estilo.css"), "body{color:red}");
  fs.writeFileSync(path.join(dir, "otra.html"), "<title>otra</title>");
  return { parent, dir, file: path.join(dir, "explicacion.html") };
}

function cli(cwd: string): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const io: Io = {
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    cwd,
    openBrowser: () => undefined,
    stateDir: path.join(cwd, "..", "state-unused"),
    localServer: false,
    startTimeoutMs: 60_000,
  };
  return { io, out: () => out, err: () => err };
}

afterEach(async () => {
  for (const r of roots) await stopManaged({ root: r, url: null }).catch(() => undefined);
  roots = [];
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("modo archivo", () => {
  it("sirve la carpeta del archivo (sin subir al workspace) y anuncia la URL de ESA pagina", async () => {
    const { dir } = fixture();
    roots.push(dir);
    const c = cli(dir);
    expect(await runCli(["explicacion.html", "--detach", "--no-open", "--json"], c.io)).toBe(EXIT.OK);
    const r = JSON.parse(c.out().trim().split("\n").pop()!);
    expect(r.page).toBe("explicacion.html");
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/explicacion\.html$/);
    expect(r.agentPrompt).toContain(dir);
    // El estado vive en la carpeta del archivo (.perfect-front), no en el monorepo padre.
    expect(readState(dir)).not.toBeNull();
    expect(fs.existsSync(path.join(dir, "..", "..", ".perfect-front"))).toBe(false);
    // Asset relativo servido.
    const base = new URL(r.url).origin;
    expect(await (await fetch(`${base}/estilo.css`)).text()).toContain("color:red");
    expect(await (await fetch(r.url)).text()).toContain("estilo.css");
  }, 90_000);

  it("--file con ruta absoluta equivale al posicional, desde otro cwd", async () => {
    const { parent, dir, file } = fixture();
    roots.push(dir);
    const c = cli(parent);
    expect(await runCli(["--file", file, "--detach", "--no-open", "--json"], c.io)).toBe(EXIT.OK);
    const r = JSON.parse(c.out().trim().split("\n").pop()!);
    expect(r.page).toBe("explicacion.html");
    expect(readState(dir)).not.toBeNull();
  }, 90_000);

  it("archivo inexistente o no .html = USAGE", async () => {
    const { dir } = fixture();
    const a = cli(dir);
    expect(await runCli(["nada.html", "--no-open"], a.io)).toBe(EXIT.USAGE);
    expect(a.err()).toContain("No existe el archivo HTML");
    const b = cli(dir);
    expect(await runCli(["--file", "estilo.css", "--no-open"], b.io)).toBe(EXIT.USAGE);
    expect(b.err()).toContain(".html");
  });

  it("`--x.html` sugiere la forma correcta y otros desconocidos no cambian", async () => {
    const { dir } = fixture();
    const a = cli(dir);
    expect(await runCli(["--explicacion-auspiciante.html"], a.io)).toBe(EXIT.USAGE);
    expect(a.err()).toContain("perfect-front explicacion-auspiciante.html");
    const b = cli(dir);
    expect(await runCli(["foo"], b.io)).toBe(EXIT.USAGE);
    expect(b.err()).toContain("Comando desconocido: foo");
  });

  it("staticTarget sirve la carpeta del archivo (root = projectDir)", () => {
    const { dir } = fixture();
    const t = staticTarget(dir, dir, 5500, { page: "explicacion.html" });
    expect(t.root).toBe(dir);
    expect(t.plan.args).toContain("explicacion.html");
    expect(t.plan.args[t.plan.args.indexOf("--root") + 1]).toBe(path.resolve(dir));
  });
});
