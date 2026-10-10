import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommentStorage } from "@perfect-front/comment-storage";
import { runCli } from "../src/run";
import { safeExportPath } from "../src/comments";

let root: string;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");

function newComment(text: string, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    scope: "element",
    comment: text,
    location: {
      url: "http://localhost:5173/pricing",
      route: "/pricing",
      title: "Pricing",
      selector: "main > button.cta",
      selectorCandidates: ["button.cta", "[data-testid=cta]"],
      text: "Buy",
      html: '<button class="cta">Buy</button>',
      componentHint: null,
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    elementRect: { x: 10, y: 20, width: 100, height: 40 },
    environment: {},
    ...extra,
  };
}

async function run(args: string[], cwd = root) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd });
  return { code, stdout, stderr };
}
const j = (s: string) => JSON.parse(s.trim());

async function seed(text = "Cambia el color del boton", extra: Record<string, unknown> = {}) {
  const storage = await createCommentStorage(root);
  return storage.createComment(newComment(text, extra));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cmt-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("proyecto", () => {
  it("sin .perfect-front sale con 3 y JSON de error", async () => {
    const r = await run(["list", "--json"]);
    expect(r.code).toBe(3);
    expect(j(r.stdout)).toMatchObject({ ok: false, error: { code: "project_not_found" } });
    expect(fs.existsSync(path.join(root, ".perfect-front"))).toBe(false);
  });

  it("funciona desde un subdirectorio y con --cwd", async () => {
    await seed();
    const sub = path.join(root, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(j((await run(["list", "--json"], sub)).stdout).count).toBe(1);
    expect(j((await run(["list", "--json", "--cwd", root], os.tmpdir())).stdout).count).toBe(1);
  });
});

describe("list", () => {
  it("por defecto solo pendientes, con JSON estable y tabla humana", async () => {
    const a = await seed("uno");
    const b = await seed("dos");
    await run(["claim", b.id]);
    const r = j((await run(["list", "--json"])).stdout);
    expect(r.ok).toBe(true);
    expect(r.comments.map((c: { id: string }) => c.id)).toEqual([a.id]);
    expect(Object.keys(r.comments[0]).sort()).toEqual(
      ["collection", "createdAt", "id", "resolvedAt", "route", "scope", "selector", "shortId", "status", "text", "title", "updatedAt", "url"].sort(),
    );
    expect(j((await run(["list", "--status", "all", "--json"])).stdout).count).toBe(2);
    expect(j((await run(["list", "--status", "in_progress", "--json"])).stdout).count).toBe(1);
    const human = await run(["list"]);
    expect(human.stdout).toContain(a.id.slice(0, 17));
    expect(human.stdout).toContain("/pricing main > button.cta");
    expect(human.stdout).not.toContain("\u001b[");
  });

  it("filtra por --q y --collection; valida --status", async () => {
    await seed("ajustar logo");
    await seed("cambiar footer");
    expect(j((await run(["list", "--q", "logo", "--json"])).stdout).count).toBe(1);
    expect(j((await run(["list", "--collection", "inbox", "--json"])).stdout).count).toBe(2);
    const bad = await run(["list", "--status", "nope", "--json"]);
    expect(bad.code).toBe(2);
    expect(j(bad.stdout).ok).toBe(false);
  });

  it("un JSON corrupto no rompe el listado", async () => {
    const a = await seed();
    fs.writeFileSync(path.join(root, ".perfect-front", "comments", "inbox", "pf_CORRUPTO123.json"), "{ no es json");
    const r = await run(["list", "--json"]);
    expect(r.code).toBe(0);
    const d = j(r.stdout);
    expect(d.comments.map((c: { id: string }) => c.id)).toEqual([a.id]);
    expect(d.errors).toHaveLength(1);
    const h = await run(["list"]);
    expect(h.code).toBe(0);
    expect(h.stderr).toContain("ilegible");
  });
});

describe("show e IDs", () => {
  it("acepta prefijo unico, devuelve datos de localizacion y adjuntos", async () => {
    const storage = await createCommentStorage(root);
    const c = await storage.createComment(newComment("con captura", { screenshot: { mimeType: "image/png", dataBase64: PNG } }));
    const r = await run(["show", c.id.slice(0, 20), "--json"]);
    expect(r.code).toBe(0);
    const d = j(r.stdout);
    expect(d.comment.location.selectorCandidates).toHaveLength(2);
    expect(d.comment.location.html).toContain("<button");
    expect(d.comment.viewport.width).toBe(1280);
    expect(d.attachments[0].path).toMatch(/^attachments\/pf_.*\.png$/);
    expect(d.attachments[0].exists).toBe(true);
    const h = await run(["show", c.id.toLowerCase().slice(0, 20)]);
    expect(h.stdout).toContain("main > button.cta");
    expect(h.stdout).toContain("HTML (texto):");
  });

  it("id inexistente: 6; prefijo ambiguo: 2; id invalido: 2", async () => {
    await seed();
    await seed();
    const nf = await run(["show", "pf_ZZZZZZZZZZZZ", "--json"]);
    expect(nf.code).toBe(6);
    expect(j(nf.stdout)).toMatchObject({ ok: false, error: { code: "not_found" } });
    const amb = await run(["show", "pf_", "--json"]);
    expect(amb.code).toBe(2);
    expect(j(amb.stdout).error.code).toBe("ambiguous_id");
    expect((await run(["show", "pf_u!", "--json"])).code).toBe(2);
    expect((await run(["show", "--json"])).code).toBe(2);
  });
});

describe("mutaciones", () => {
  it("claim: pending -> in_progress y no repite", async () => {
    const c = await seed();
    const r = await run(["claim", c.id, "--json"]);
    expect(j(r.stdout).comment.status).toBe("in_progress");
    expect((await run(["claim", c.id, "--json"])).code).toBe(7);
  });

  it("edit, move, ignore, reopen y status", async () => {
    const c = await seed();
    expect(j((await run(["edit", c.id, "--comment", "nuevo texto", "--json"])).stdout).comment.comment).toBe("nuevo texto");
    expect((await run(["edit", c.id, "--json"])).code).toBe(2);
    await createCommentStorage(root).then((s) => s.createCollection("sprint-1"));
    const mv = j((await run(["move", c.id, "--to", "sprint-1", "--json"])).stdout);
    expect(mv.results[0].comment.collection).toBe("sprint-1");
    expect(fs.existsSync(path.join(root, ".perfect-front", "comments", "sprint-1", `${c.id}.json`))).toBe(true);
    expect((await run(["move", c.id, "--to", "no-existe", "--json"])).code).toBe(6);
    expect((await run(["move", c.id, "--json"])).code).toBe(2);
    expect(j((await run(["ignore", c.id, "--json"])).stdout).comment.status).toBe("ignored");
    expect(j((await run(["reopen", c.id, "--json"])).stdout).comment.status).toBe("pending");
    expect(j((await run(["status", c.id, "in_progress", "--json"])).stdout).comment.status).toBe("in_progress");
    expect((await run(["status", c.id, "resolved", "--json"])).code).toBe(2);
    expect(j((await run(["status", c.id, "archived", "--json"])).stdout).comment.collection).toBe("archived");
  });

  it("`status` sin id sigue siendo el estado del servidor (no el de comentarios)", async () => {
    const r = await run(["status", "--json", "--cwd", root]);
    expect(r.code).not.toBe(2);
  });
});

describe("resolve", () => {
  it("registra la resolucion, mueve a resolved y conserva datos y adjuntos", async () => {
    const storage = await createCommentStorage(root);
    const c = await storage.createComment(newComment("fix", { screenshot: { mimeType: "image/png", dataBase64: PNG } }));
    const r = await run([
      "resolve", c.id, "--summary", "Boton ahora azul", "--files", "src/a.tsx, src/b.css", "--verification", "pnpm build ok",
      "--verification", "revisado en navegador", "--commit", "abc1234", "--by", "agent", "--json",
    ]);
    expect(r.code).toBe(0);
    const d = j(r.stdout).comment;
    expect(d.status).toBe("resolved");
    expect(d.collection).toBe("resolved");
    expect(d.resolution).toMatchObject({
      summary: "Boton ahora azul",
      filesChanged: ["src/a.tsx", "src/b.css"],
      verification: ["pnpm build ok", "revisado en navegador"],
      commit: "abc1234",
      resolvedBy: "agent",
    });
    expect(d.comment).toBe("fix");
    expect(d.createdAt).toBe(c.createdAt);
    expect(d.location).toEqual(c.location);
    expect(d.attachments).toEqual(c.attachments);
    expect(fs.existsSync(path.join(root, ".perfect-front", c.attachments[0]!))).toBe(true);
    expect(fs.existsSync(path.join(root, ".perfect-front", "comments", "inbox", `${c.id}.json`))).toBe(false);
    // resolver de nuevo es conflicto; reopen limpia la resolucion pero conserva adjuntos
    expect((await run(["resolve", c.id, "--summary", "x", "--json"])).code).toBe(7);
    const re = j((await run(["reopen", c.id, "--json"])).stdout).comment;
    expect(re).toMatchObject({ status: "pending", collection: "inbox", resolution: null });
    expect(re.attachments).toEqual(c.attachments);
  });

  it("valida summary y --by", async () => {
    const c = await seed();
    expect((await run(["resolve", c.id, "--json"])).code).toBe(2);
    expect((await run(["resolve", c.id, "--summary", "x", "--by", "robot", "--json"])).code).toBe(2);
  });
});

describe("bloqueo optimista", () => {
  it("revision obsoleta falla con 7 y no modifica; la vigente funciona (--rev incluido)", async () => {
    const c = await seed();
    const stale = c.updatedAt;
    await new Promise((r) => setTimeout(r, 1100));
    await run(["edit", c.id, "--comment", "cambio externo"]);
    const cur = j((await run(["show", c.id, "--json"])).stdout).comment;
    expect(cur.updatedAt).not.toBe(stale);

    for (const args of [
      ["edit", c.id, "--comment", "x"],
      ["move", c.id, "--to", "resolved"],
      ["resolve", c.id, "--summary", "x"],
      ["ignore", c.id],
      ["reopen", c.id],
    ]) {
      const r = await run([...args, "--expect-updated-at", stale, "--json"]);
      expect(r.code, args[0]).toBe(7);
      expect(j(r.stdout)).toMatchObject({ ok: false, error: { code: "stale_revision" } });
    }
    expect(j((await run(["show", c.id, "--json"])).stdout).comment.updatedAt).toBe(cur.updatedAt);
    expect((await run(["edit", c.id, "--comment", "ok", "--rev", cur.updatedAt, "--json"])).code).toBe(0);
    expect((await run(["edit", c.id, "--comment", "ok", "--expect-updated-at", "no-fecha", "--json"])).code).toBe(2);
  });
});

describe("export", () => {
  it("imprime Markdown, y escribe dentro de .perfect-front", async () => {
    const c = await seed("exportame");
    const out = await run(["export", "--format", "md"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(c.id);
    const w = await run(["export", "--out", "exports/reporte.md", "--json"]);
    expect(j(w.stdout)).toMatchObject({ ok: true, file: "exports/reporte.md", count: 1 });
    expect(fs.readFileSync(path.join(root, ".perfect-front", "exports", "reporte.md"), "utf8")).toContain(c.id);
  });

  it("rechaza traversal, rutas absolutas externas y extensiones no .md", async () => {
    await seed();
    for (const bad of ["../fuera.md", "..\\fuera.md", path.join(os.tmpdir(), "x.md"), "project.json", "inbox/x.json", "."]) {
      const r = await run(["export", "--out", bad, "--json"]);
      expect(r.code, bad).toBe(2);
    }
    expect(fs.existsSync(path.join(root, "fuera.md"))).toBe(false);
    expect(() => safeExportPath(path.join(root, ".perfect-front"), "a/../../x.md")).toThrow();
  });
});

describe("uso", () => {
  it("opciones desconocidas: 2 con JSON; --help imprime ayuda sin tocar el proyecto", async () => {
    await seed();
    const r = await run(["list", "--bogus", "--json"]);
    expect(r.code).toBe(2);
    expect(j(r.stdout).ok).toBe(false);
    const h = await run(["list", "--help"], os.tmpdir());
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("Codigos de salida");
  });
});
