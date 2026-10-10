import { mkdirSync, mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DetectionError, MAX_STATIC_PAGES, detectProject, normalizePagePath } from "../src/index";

const fx = (n: string): string => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", n);
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function site(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-static-"));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
  return root;
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

describe("HTML estático: elección de página", () => {
  it("index.html manda sobre varios .html", () => {
    const r = detectProject({ cwd: fx("static-index") });
    expect(r.kind).toBe("static");
    expect(r.framework).toBeNull();
    expect(r.root).toBe(fx("static-index"));
    expect(r.static).toMatchObject({ entry: "index.html", status: "chosen", choice: "index", truncated: false });
    expect(r.static?.pages).toEqual(["index.html", "about.html", "contact.html"]);
    expect(r.plan.source).toBe("static");
    expect(r.url).toBe("http://127.0.0.1:5500/index.html");
  });

  it("sin index.html y varios: needs_choice (no es error)", () => {
    const r = detectProject({ cwd: fx("static-multi") });
    expect(r.static).toMatchObject({ entry: null, status: "needs_choice", choice: null });
    expect(r.static?.pages).toEqual(["about.html", "contact.html", "pricing.html"]);
    expect(r.url).toBe("http://127.0.0.1:5500/");
  });

  it("un solo .html sin index: automático", () => {
    const r = detectProject({ cwd: fx("static-single") });
    expect(r.static).toMatchObject({ entry: "landing.html", status: "chosen", choice: "single" });
  });

  it("sin HTML en la raíz: busca hasta profundidad 2", () => {
    const r = detectProject({ cwd: fx("static-nested") });
    expect(r.static?.pages).toEqual(["site/home.html", "site/blog/post.html"]);
    expect(r.static?.status).toBe("needs_choice");
  });

  it("ignora node_modules, dist, build, .git, .perfect-front y dotdirs", () => {
    const root = site({
      "a/ok.html": "x",
      "node_modules/p/x.html": "x",
      "dist/x.html": "x",
      "build/x.html": "x",
      ".git/x.html": "x",
      ".perfect-front/x.html": "x",
      ".hidden/x.html": "x",
    });
    expect(detectProject({ cwd: root }).static).toMatchObject({ pages: ["a/ok.html"], entry: "a/ok.html", choice: "single" });
  });

  it("si hay HTML en la raíz no busca en subcarpetas", () => {
    const root = site({ "top.html": "x", "sub/other.html": "x" });
    expect(detectProject({ cwd: root }).static?.pages).toEqual(["top.html"]);
  });

  it("trunca la lista con aviso", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_STATIC_PAGES + 5; i++) files[`p${String(i).padStart(3, "0")}.html`] = "x";
    const r = detectProject({ cwd: site(files) });
    expect(r.static?.pages).toHaveLength(MAX_STATIC_PAGES);
    expect(r.static?.truncated).toBe(true);
  });
});

describe("HTML estático: override, config y precedencia", () => {
  it("--page gana a index.html y se normaliza", () => {
    const r = detectProject({ cwd: fx("static-index"), overrides: { page: "./about.html" } });
    expect(r.static).toMatchObject({ entry: "about.html", choice: "override" });
    expect(r.url).toBe("http://127.0.0.1:5500/about.html");
  });

  it("--page resuelve needs_choice", () => {
    const r = detectProject({ cwd: fx("static-multi"), overrides: { page: "pricing.html" } });
    expect(r.static?.status).toBe("chosen");
  });

  it.each(["/etc/passwd.html", "C:\\x.html", "../x.html", "a/../about.html", "nope.html", "about.txt", "", "about.html\0"])(
    "rechaza --page %j",
    (page) => {
      const e = failure(() => detectProject({ cwd: fx("static-index"), overrides: { page } }));
      expect(e.reason).toBe("invalid_command");
    },
  );

  it("entry de project.json gana a index.html; --choose lo ignora", () => {
    const root = site({ "index.html": "x", "b.html": "x", ".perfect-front/project.json": JSON.stringify({ version: 1, entry: "b.html" }) });
    const a = detectProject({ cwd: root });
    expect(a.static).toMatchObject({ entry: "b.html", choice: "config" });
    expect(a.configPath).not.toBeNull();
    const c = detectProject({ cwd: root, overrides: { choose: true } });
    expect(c.static).toMatchObject({ entry: null, status: "needs_choice" });
    const p = detectProject({ cwd: root, overrides: { page: "index.html" } });
    expect(p.static?.entry).toBe("index.html");
  });

  it("entry que ya no existe se ignora y cae a la elección normal", () => {
    const root = site({ "index.html": "x", "b.html": "x", ".perfect-front/project.json": JSON.stringify({ version: 1, entry: "gone.html" }) });
    const r = detectProject({ cwd: root });
    expect(r.static).toMatchObject({ entry: "index.html", choice: "index" });
    expect(r.reasons.some((x) => x.message.includes("ya no está"))).toBe(true);
  });

  it("entry inseguro en project.json es configuración inválida", () => {
    const root = site({ "index.html": "x", ".perfect-front/project.json": JSON.stringify({ version: 1, entry: "../x.html" }) });
    expect(failure(() => detectProject({ cwd: root })).reason).toBe("invalid_config");
  });

  it("Vite gana sobre static; comando explícito gana sobre static", () => {
    const root = site({ "index.html": "x", "package.json": JSON.stringify({ name: "v", devDependencies: { vite: "^6" }, scripts: { dev: "vite" } }) });
    expect(detectProject({ cwd: root })).toMatchObject({ kind: "dev-server", static: null });
    const plain = site({ package: "x", "index.html": "x", "package.json": "{}" });
    const r = detectProject({ cwd: plain, overrides: { command: "node s.js" } });
    expect(r.kind).toBe("dev-server");
  });

  it("package.json sin runner ni scripts + HTML = static; con script desconocido sigue sin soporte", () => {
    const ok = site({ "index.html": "x", "package.json": JSON.stringify({ name: "p" }) });
    expect(detectProject({ cwd: ok }).kind).toBe("static");
    const bad = site({ "index.html": "x", "package.json": JSON.stringify({ name: "p", scripts: { dev: "node s.js" } }) });
    expect(failure(() => detectProject({ cwd: bad })).reason).toBe("framework_unknown");
  });

  it("sin HTML sigue siendo framework_unknown / root_not_found", () => {
    expect(failure(() => detectProject({ cwd: site({ "a.txt": "x" }) })).reason).toBe("root_not_found");
    expect(failure(() => detectProject({ cwd: site({ "package.json": "{}" }) })).reason).toBe("framework_unknown");
  });

  it("--port fija el puerto preferido de la URL candidata", () => {
    expect(detectProject({ cwd: fx("static-single"), overrides: { port: 6123 } }).url).toBe("http://127.0.0.1:6123/landing.html");
  });

  it("es pura: no escribe en disco", () => {
    for (const n of ["static-index", "static-multi", "static-single", "static-nested"]) {
      const before = readdirSync(fx(n), { recursive: true }).map(String).sort();
      expect(detectProject({ cwd: fx(n) })).toEqual(detectProject({ cwd: fx(n) }));
      expect(readdirSync(fx(n), { recursive: true }).map(String).sort()).toEqual(before);
    }
  });
});

describe("normalizePagePath", () => {
  it("acepta rutas seguras y normaliza", () => {
    expect(normalizePagePath("a\\b.html")).toBe("a/b.html");
    expect(normalizePagePath("./././x.HTML")).toBe("x.HTML");
  });
  it("rechaza escapes", () => {
    for (const v of ["..", "../a.html", "/a.html", "\\\\srv\\a.html", "c:/a.html", "a//b.html", "a/b.js"]) expect(normalizePagePath(v)).toBeNull();
  });
});
