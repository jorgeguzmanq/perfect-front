import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommentStorage } from "../src/index";
import { PNG_B64, commentInput, listNames, sleep, tempDir, tempProject } from "./helpers";

describe("init", () => {
  it("crea .perfect-front con config y colecciones por defecto (ruta con espacios)", async () => {
    const root = await tempDir("pf con espacios ");
    const storage = await CommentStorage.init(root);
    expect(storage.initReport.createdConfig).toBe(true);
    const pf = path.join(root, ".perfect-front");
    expect(await listNames(path.join(pf, "comments"))).toEqual(["archived", "inbox", "resolved"]);
    const config = JSON.parse(await readFile(path.join(pf, "project.json"), "utf8"));
    expect(config).toMatchObject({ version: 1, defaultCollection: "inbox", resolvedCollection: "resolved" });
  });

  it("no sobrescribe una configuración existente y es idempotente", async () => {
    const root = await tempDir();
    await CommentStorage.init(root);
    const file = path.join(root, ".perfect-front", "project.json");
    const custom = JSON.stringify({ version: 1, name: "Custom", defaultCollection: "mobile" });
    await writeFile(file, custom);
    const again = await CommentStorage.init(root);
    expect(again.initReport.createdConfig).toBe(false);
    expect(await readFile(file, "utf8")).toBe(custom);
    // la colección configurada se crea
    expect((await again.listCollections()).map((c) => c.name)).toContain("mobile");
  });

  it("rechaza una configuración existente inválida sin reemplazarla", async () => {
    const root = await tempDir();
    await CommentStorage.init(root);
    const file = path.join(root, ".perfect-front", "project.json");
    await writeFile(file, "{ no es json");
    await expect(CommentStorage.init(root)).rejects.toMatchObject({ code: "invalid_data" });
    expect(await readFile(file, "utf8")).toBe("{ no es json");
  });

  it("falla si la raíz no existe", async () => {
    const root = await tempDir();
    await expect(CommentStorage.init(path.join(root, "nope"))).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("comentarios", () => {
  it("crea en inbox, lee por ID y lista", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    expect(c).toMatchObject({ status: "pending", collection: "inbox", resolution: null });
    expect(await listNames(path.join(root, ".perfect-front", "comments", "inbox"))).toEqual([`${c.id}.json`]);
    expect((await storage.getComment(c.id)).id).toBe(c.id);
    const { comments, errors } = await storage.listComments();
    expect(comments.map((x) => x.id)).toEqual([c.id]);
    expect(errors).toEqual([]);
  });

  it("valida la entrada con los esquemas compartidos", async () => {
    const { storage } = await tempProject();
    await expect(storage.createComment({ ...commentInput(), comment: "" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(storage.createComment({ ...commentInput(), extra: 1 })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("crea en una colección existente y rechaza una inexistente", async () => {
    const { storage } = await tempProject();
    await storage.createCollection("mobile");
    const c = await storage.createComment(commentInput({ collection: "mobile" }));
    expect(c.collection).toBe("mobile");
    await expect(storage.createComment(commentInput({ collection: "ghost" }))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("edita y actualiza updatedAt sin tocar createdAt", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    await sleep(5);
    const e = await storage.updateComment(c.id, { comment: "Nuevo texto" });
    expect(e.comment).toBe("Nuevo texto");
    expect(e.createdAt).toBe(c.createdAt);
    expect(e.updatedAt > c.updatedAt).toBe(true);
    expect((await storage.getComment(c.id)).comment).toBe("Nuevo texto");
    await expect(storage.updateComment(c.id, {})).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("filtra por estado y texto", async () => {
    const { storage } = await tempProject();
    const a = await storage.createComment(commentInput({ comment: "alpha" }));
    await storage.createComment(commentInput({ comment: "beta" }));
    await storage.ignoreComment(a.id);
    expect((await storage.listComments({ status: "ignored" })).comments.map((c) => c.id)).toEqual([a.id]);
    expect((await storage.listComments({ q: "BETA" })).comments).toHaveLength(1);
  });
});

describe("mover", () => {
  it("rename: una sola copia, collection actualizada, adjunto intacto", async () => {
    const { root, storage } = await tempProject();
    await storage.createCollection("mobile");
    const c = await storage.createComment(commentInput({ screenshot: { mimeType: "image/png", dataBase64: PNG_B64 } }));
    await sleep(5);
    const m = await storage.moveComment(c.id, "mobile");
    expect(m.collection).toBe("mobile");
    expect(m.updatedAt > c.updatedAt).toBe(true);
    expect(m.attachments).toEqual(c.attachments);
    const comments = path.join(root, ".perfect-front", "comments");
    expect(await listNames(path.join(comments, "inbox"))).toEqual([]);
    expect(await listNames(path.join(comments, "mobile"))).toEqual([`${c.id}.json`]);
    const onDisk = JSON.parse(await readFile(path.join(comments, "mobile", `${c.id}.json`), "utf8"));
    expect(onDisk.collection).toBe("mobile");
    expect(await listNames(path.join(root, ".perfect-front", "attachments"))).toHaveLength(1);
  });

  it("mover a la misma colección no cambia nada; destino inexistente falla", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    expect(await storage.moveComment(c.id, "inbox")).toEqual(c);
    await expect(storage.moveComment(c.id, "ghost")).rejects.toMatchObject({ code: "not_found" });
    expect((await storage.getComment(c.id)).collection).toBe("inbox");
  });

  it("por lote: reporta fallos individuales", async () => {
    const { storage } = await tempProject();
    const a = await storage.createComment(commentInput());
    const res = await storage.moveComments([a.id, "pf_ZZZZZZ"], "archived");
    expect(res[0]).toMatchObject({ ok: true });
    expect(res[1]).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("al leer, manda la carpeta aunque el campo collection esté desfasado", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    const file = path.join(root, ".perfect-front", "comments", "inbox", `${c.id}.json`);
    const doc = JSON.parse(await readFile(file, "utf8"));
    doc.collection = "resolved";
    await writeFile(file, JSON.stringify(doc));
    expect((await storage.getComment(c.id)).collection).toBe("inbox");
  });
});

describe("estados", () => {
  it("resolver mueve a resolved y guarda la resolución; reabrir la limpia", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    const r = await storage.resolveComment(c.id, {
      summary: "Ancho completo",
      filesChanged: ["src/Buy.tsx"],
      resolvedBy: "codex",
    });
    expect(r).toMatchObject({ status: "resolved", collection: "resolved" });
    expect(r.resolution).toMatchObject({ summary: "Ancho completo", filesChanged: ["src/Buy.tsx"], commit: null });
    const o = await storage.reopenComment(c.id);
    expect(o).toMatchObject({ status: "pending", collection: "inbox", resolution: null });
    expect((await storage.listCollections()).find((x) => x.name === "resolved")!.count).toBe(0);
  });

  it("ignorar no mueve; archivar mueve a archived", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    expect(await storage.ignoreComment(c.id)).toMatchObject({ status: "ignored", collection: "inbox" });
    expect(await storage.archiveComment(c.id)).toMatchObject({ status: "archived", collection: "archived" });
    expect(await storage.reopenComment(c.id)).toMatchObject({ status: "pending", collection: "inbox" });
  });

  it("resolver exige resumen", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    await expect(storage.resolveComment(c.id, {})).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("adjuntos", () => {
  it("se guardan en attachments/, fuera de las carpetas de comentarios", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput({ screenshot: { mimeType: "image/png", dataBase64: PNG_B64 } }));
    expect(c.attachments).toEqual([`attachments/${c.id}.png`]);
    const pf = path.join(root, ".perfect-front");
    expect(await listNames(path.join(pf, "attachments"))).toEqual([`${c.id}.png`]);
    for (const col of await readdir(path.join(pf, "comments"))) {
      expect((await readdir(path.join(pf, "comments", col))).filter((f) => !f.endsWith(".json"))).toEqual([]);
    }
  });

  it("rechaza contenido que no coincide con el tipo y no deja residuos", async () => {
    const { root, storage } = await tempProject();
    const fake = Buffer.from("no soy un png").toString("base64");
    await expect(
      storage.createComment(commentInput({ screenshot: { mimeType: "image/png", dataBase64: fake } })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await listNames(path.join(root, ".perfect-front", "attachments"))).toEqual([]);
    expect((await storage.listComments()).comments).toEqual([]);
  });
});

describe("exportación y gitignore", () => {
  it("Markdown es de solo lectura y no rompe con backticks ni HTML", async () => {
    const { root, storage } = await tempProject();
    const input = commentInput({ comment: "Línea 1\nLínea 2 con ``` fence" });
    (input["location"] as Record<string, unknown>)["html"] = "<p>```</p><script>alert(1)</script>";
    const c = await storage.createComment(input);
    const file = path.join(root, ".perfect-front", "comments", "inbox", `${c.id}.json`);
    const before = await readFile(file, "utf8");
    const { markdown, count } = await storage.exportMarkdown({ collection: "inbox" });
    expect(count).toBe(1);
    expect(markdown).toContain(c.id);
    expect(markdown).toContain("````html"); // valla más larga que los backticks internos
    expect(markdown).toContain("> Línea 2 con ``` fence");
    expect(await readFile(file, "utf8")).toBe(before);
    const written = await storage.writeMarkdownExport();
    expect(written.file).toMatch(/^exports\/comments-\d{4}-\d{2}-\d{2}\.md$/);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("sugiere .gitignore sin modificarlo", async () => {
    const { root, storage } = await tempProject();
    expect(await storage.suggestGitignore()).toMatchObject({ exists: false, alreadyIgnored: false, snippet: ".perfect-front/\n" });
    const gi = path.join(root, ".gitignore");
    await writeFile(gi, "node_modules\n");
    expect(await storage.suggestGitignore()).toMatchObject({ exists: true, alreadyIgnored: false });
    expect(await readFile(gi, "utf8")).toBe("node_modules\n");
    await writeFile(gi, "node_modules\r\n/.perfect-front/\r\n");
    expect(await storage.suggestGitignore()).toMatchObject({ alreadyIgnored: true, snippet: null });
    await writeFile(gi, ".perfect-front/\n!.perfect-front/\n");
    expect(await storage.suggestGitignore()).toMatchObject({ alreadyIgnored: false });
  });

  it("no deja temporales en .tmp tras operar", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    await storage.updateComment(c.id, { comment: "x" });
    await storage.moveComment(c.id, "archived");
    expect(await listNames(path.join(root, ".perfect-front", ".tmp"))).toEqual([]);
  });
});
