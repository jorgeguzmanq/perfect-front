import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readState } from "../src/process/state";
import { stopManaged } from "../src/process";
import { isAlive } from "../src/process/identity";
import { EXIT, runCli, type Io } from "../src/run";
import { confirmKey, pickPage, type PickerInput } from "../src/static/picker";
import { rememberEntry } from "../src/static/remember";

const KEY = { up: "\u001b[A", down: "\u001b[B", enter: "\r", ctrlC: "\u0003" };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let dirs: string[] = [];
let roots: string[] = [];
let pids: number[] = [];

function site(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pf-sel-")));
  dirs.push(root);
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return root;
}

function fakeTty(): { input: PassThrough & PickerInput; output: { write: (s: string) => void }; text: () => string } {
  const input = new PassThrough() as PassThrough & PickerInput;
  let buf = "";
  return { input, output: { write: (s) => void (buf += s) }, text: () => buf };
}

async function until(fn: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(10);
  }
}

function cli(cwd: string, extra: Partial<Io> = {}): { io: Io; out: () => string; err: () => string; opened: string[] } {
  let out = "";
  let err = "";
  const opened: string[] = [];
  const io: Io = {
    cwd,
    stdout: (s) => void (out += s),
    stderr: (s) => void (err += s),
    openBrowser: (u) => void opened.push(u),
    localServer: false,
    stateDir: path.join(cwd, "..", "state-unused"),
    startTimeoutMs: 30_000,
    ...extra,
  };
  return { io, out: () => out, err: () => err, opened };
}

beforeEach(() => {
  dirs = [];
  roots = [];
  pids = [];
});
afterEach(async () => {
  for (const r of roots) {
    const st = readState(r);
    if (st) pids.push(st.pid);
    await stopManaged({ root: r, url: null });
  }
  await sleep(200);
  expect(pids.filter((p) => isAlive(p)), "procesos huerfanos").toEqual([]);
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("selector interactivo (stream simulado)", () => {
  const pages = ["a.html", "b.html", "c.html"];

  it("flechas + Enter; el ciclo da la vuelta", async () => {
    const t = fakeTty();
    const p = pickPage(pages, t);
    await sleep(20);
    t.input.write(KEY.down + KEY.down + KEY.enter);
    expect(await p).toBe("c.html");
    expect(t.text()).toContain("1) a.html");
    expect(t.text()).toContain("Seleccionada: c.html");

    const t2 = fakeTty();
    const p2 = pickPage(pages, t2);
    await sleep(20);
    t2.input.write(KEY.up + KEY.enter); // desde la primera, hacia arriba = ultima
    expect(await p2).toBe("c.html");
  });

  it("Enter directo elige la primera; el numero salta a esa opcion (varios digitos)", async () => {
    const t = fakeTty();
    const p = pickPage(pages, t);
    await sleep(20);
    t.input.write(KEY.enter);
    expect(await p).toBe("a.html");

    const many = Array.from({ length: 25 }, (_, i) => `p${i + 1}.html`);
    const t2 = fakeTty();
    const p2 = pickPage(many, t2);
    await sleep(20);
    t2.input.write("1" + "7" + KEY.enter);
    expect(await p2).toBe("p17.html");

    const t3 = fakeTty();
    const p3 = pickPage(pages, t3);
    await sleep(20);
    t3.input.write("2" + KEY.enter);
    expect(await p3).toBe("b.html");
  });

  it("Ctrl+C cancela con null y deja stdin en pausa (no retiene el proceso)", async () => {
    const t = fakeTty();
    const p = pickPage(pages, t);
    await sleep(20);
    t.input.write(KEY.ctrlC);
    expect(await p).toBeNull();
    expect(t.input.isPaused()).toBe(true);
    expect(t.input.listenerCount("keypress")).toBe(0);
    expect(t.text()).toContain("Cancelado");
  });

  it("abortar la senal cancela; fin de entrada tambien", async () => {
    const t = fakeTty();
    const ac = new AbortController();
    const p = pickPage(pages, { ...t, signal: ac.signal });
    await sleep(20);
    ac.abort();
    expect(await p).toBeNull();
    const t2 = fakeTty();
    const p2 = pickPage(pages, t2);
    await sleep(20);
    t2.input.end();
    expect(await p2).toBeNull();
  });

  it("confirmKey: s = si; Enter = no; Ctrl+C = null", async () => {
    for (const [keys, expected] of [
      ["s", true],
      ["y", true],
      [KEY.enter, false],
      ["n", false],
      [KEY.ctrlC, null],
    ] as const) {
      const t = fakeTty();
      const p = confirmKey("¿Recordar?", t);
      await sleep(20);
      t.input.write(keys);
      expect(await p, JSON.stringify(keys)).toBe(expected);
    }
  });
});

describe("rememberEntry: solo escribe dentro de .perfect-front/project.json", () => {
  it("crea la config minima valida si no existe", () => {
    const root = site({ "a.html": "x" });
    const r = rememberEntry(root, "a.html");
    expect(r.created).toBe(true);
    expect(r.file).toBe(path.join(root, ".perfect-front", "project.json"));
    expect(JSON.parse(fs.readFileSync(r.file, "utf8"))).toEqual({ version: 1, entry: "a.html" });
    expect(fs.readdirSync(root).sort()).toEqual([".perfect-front", "a.html"]);
    expect(fs.readdirSync(path.join(root, ".perfect-front"))).toEqual(["project.json"]);
  });

  it("conserva el resto de campos y reemplaza entry", () => {
    const root = site({ ".perfect-front/project.json": JSON.stringify({ version: 1, name: "Mi sitio", openBrowser: false, entry: "viejo.html" }) });
    const r = rememberEntry(root, "docs/nuevo.html");
    expect(r.created).toBe(false);
    expect(JSON.parse(fs.readFileSync(r.file, "utf8"))).toEqual({ version: 1, name: "Mi sitio", openBrowser: false, entry: "docs/nuevo.html" });
  });

  it("no pisa un archivo ilegible o invalido; rechaza rutas inseguras", () => {
    const bad = site({ ".perfect-front/project.json": "{ no es json" });
    expect(() => rememberEntry(bad, "a.html")).toThrow();
    expect(fs.readFileSync(path.join(bad, ".perfect-front", "project.json"), "utf8")).toBe("{ no es json");
    const invalid = site({ ".perfect-front/project.json": JSON.stringify({ version: 1, campoAjeno: 1 }) });
    expect(() => rememberEntry(invalid, "a.html")).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(invalid, ".perfect-front", "project.json"), "utf8"))).toEqual({ version: 1, campoAjeno: 1 });
    const ok = site({});
    for (const e of ["../x.html", "/abs.html", "C:/x.html", "a\\b.html", "x.txt"]) expect(() => rememberEntry(ok, e)).toThrow();
    expect(fs.existsSync(path.join(ok, ".perfect-front"))).toBe(false);
  });
});

describe("CLI no interactivo con HTML sin index.html", () => {
  it("sin TTY no adivina: codigo de uso (2), lista y como elegir; no crea nada", async () => {
    const root = site({ "about.html": "x", "pricing.html": "x" });
    const c = cli(root);
    expect(await runCli(["--detach", "--no-open"], c.io)).toBe(EXIT.USAGE);
    expect(c.err()).toContain("about.html");
    expect(c.err()).toContain("pricing.html");
    expect(c.err()).toContain("--page");
    expect(fs.readdirSync(root).sort()).toEqual(["about.html", "pricing.html"]); // ni .perfect-front
  });

  it("--json devuelve la lista en stdout con ok:false y codigo 2", async () => {
    const root = site({ "about.html": "x", "pricing.html": "x" });
    const c = cli(root, { tty: fakeTty() });
    expect(await runCli(["--json"], c.io)).toBe(EXIT.USAGE);
    const j = JSON.parse(c.out()) as { ok: boolean; error: { code: string }; pages: string[]; hint: string };
    expect(j).toMatchObject({ ok: false, error: { code: "invalid_request" }, pages: ["about.html", "pricing.html"] });
    expect(j.hint).toContain("--page");
    expect(fs.existsSync(path.join(root, ".perfect-front"))).toBe(false);
  });

  it("--page invalido (absoluta, .., fuera de la lista) = uso (2)", async () => {
    const root = site({ "about.html": "x", "pricing.html": "x" });
    for (const page of ["/etc/passwd", "..\\x.html", "../x.html", "C:\\x.html", "nope.html"]) {
      const c = cli(root);
      expect(await runCli(["--detach", "--no-open", "--page", page], c.io), page).toBe(EXIT.USAGE);
    }
    const c = cli(root);
    expect(await runCli(["--fallback", "../x.html", "--detach"], c.io)).toBe(EXIT.USAGE);
  });

  it("Ctrl+C en el selector: 130, sin procesos ni archivos", async () => {
    const root = site({ "about.html": "x", "pricing.html": "x" });
    const t = fakeTty();
    const c = cli(root, { tty: t });
    const p = runCli(["--detach", "--no-open"], c.io);
    await until(() => t.text().includes("about.html"));
    t.input.write(KEY.ctrlC);
    expect(await p).toBe(EXIT.INTERRUPTED);
    expect(readState(root)).toBeNull();
    expect(fs.readdirSync(root).sort()).toEqual(["about.html", "pricing.html"]);
  });
});

describe("CLI interactivo (terminal simulada) con servidor estatico real", () => {
  it("elige con flechas, confirma recordar, abre la pagina y no vuelve a preguntar", async () => {
    const root = site({ "about.html": "<title>about</title>", "pricing.html": "<title>precios</title>" });
    const t = fakeTty();
    const c = cli(root, { tty: t });
    const p = runCli(["--detach", "--no-open"], c.io);
    await until(() => t.text().includes("pricing.html"));
    t.input.write(KEY.down + KEY.enter);
    await until(() => t.text().includes("Recordar"));
    t.input.write("s");
    expect(await p).toBe(EXIT.OK);
    const cfg = path.join(root, ".perfect-front", "project.json");
    expect(JSON.parse(fs.readFileSync(cfg, "utf8"))).toEqual({ version: 1, entry: "pricing.html" });
    const st = readState(root)!;
    pids.push(st.pid);
    expect(isAlive(st.pid)).toBe(true);
    expect(c.out()).toMatch(/URL del proyecto: http:\/\/127\.0\.0\.1:\d+\/pricing\.html/);
    const url = /URL del proyecto: (\S+)/.exec(c.out())![1]!;
    expect(await (await fetch(url)).text()).toContain("precios");

    // Segunda ejecucion: recordada, sin TTY y sin preguntar (se conecta al servidor ya activo).
    const c2 = cli(root);
    expect(await runCli(["--detach", "--no-open"], c2.io)).toBe(EXIT.OK);
    expect(c2.out()).toContain("pricing.html");
    // --choose obliga a elegir de nuevo (sin TTY: lista y uso).
    const c3 = cli(root);
    expect(await runCli(["--detach", "--no-open", "--choose"], c3.io)).toBe(EXIT.USAGE);
    // --page gana a la recordada.
    const c4 = cli(root);
    expect(await runCli(["--detach", "--no-open", "--page", "about.html"], c4.io)).toBe(EXIT.OK);
    expect(c4.out()).toContain("about.html");
    expect(JSON.parse(fs.readFileSync(cfg, "utf8")).entry).toBe("pricing.html"); // --page no escribe
  }, 90_000);

  it("sin confirmar (Enter = No) no escribe nada", async () => {
    const root = site({ "about.html": "x", "pricing.html": "x" });
    const t = fakeTty();
    const c = cli(root, { tty: t });
    const p = runCli(["--detach", "--no-open"], c.io);
    await until(() => t.text().includes("pricing.html"));
    t.input.write(KEY.enter);
    await until(() => t.text().includes("Recordar"));
    t.input.write(KEY.enter);
    expect(await p).toBe(EXIT.OK);
    expect(fs.existsSync(path.join(root, ".perfect-front", "project.json"))).toBe(false);
    expect(c.out()).toContain("about.html");
  }, 60_000);

  it("index.html manda: abre index.html sin preguntar aunque haya mas paginas", async () => {
    const root = site({ "index.html": "<title>home</title>", "otra.html": "x" });
    const c = cli(root, { tty: fakeTty() });
    expect(await runCli(["--detach", "--no-open", "--json"], c.io)).toBe(EXIT.OK);
    const j = JSON.parse(c.out()) as { url: string; page: string; pages: string[] };
    expect(j.page).toBe("index.html");
    expect(j.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
    expect(j.pages).toEqual(["index.html", "otra.html"]);
    expect(await (await fetch(j.url)).text()).toContain("home");
  }, 60_000);
});
