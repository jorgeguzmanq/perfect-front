import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommentStorage } from "../src/index";
import { commentInput, tempDir, tempProject } from "./helpers";

const BAD_COLLECTIONS = [
  "..",
  "../outside",
  "a/b",
  "a\\b",
  "con",
  "NUL",
  "com1",
  "lpt9",
  "Mayusculas",
  "x\u0000y",
  "x\ny",
  "",
  ".hidden",
  "a".repeat(65),
];

const BAD_IDS = ["..", "../pf_ABCDEF", "pf_ABCDEF/../x", "pf_abcdef", "pf_ABC", "pf_ABCDEF.json", "con", "pf_AB\u0000CDEF", ""];

describe("traversal y nombres peligrosos", () => {
  it.each(BAD_COLLECTIONS)("rechaza la colección %j", async (name) => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    await expect(storage.createCollection(name)).rejects.toMatchObject({ code: "invalid_collection" });
    await expect(storage.moveComment(c.id, name)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.listComments({ collection: name })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.createComment(commentInput({ collection: name }))).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it.each(BAD_IDS)("rechaza el ID %j", async (id) => {
    const { storage } = await tempProject();
    await expect(storage.getComment(id)).rejects.toMatchObject({ code: "invalid_id" });
    await expect(storage.updateComment(id, { comment: "x" })).rejects.toMatchObject({ code: "invalid_id" });
    await expect(storage.moveComment(id, "archived")).rejects.toMatchObject({ code: "invalid_id" });
    await expect(storage.resolveComment(id, { summary: "x" })).rejects.toMatchObject({ code: "invalid_id" });
  });

  it("no se crea nada fuera de .perfect-front al intentar traversal", async () => {
    const parent = await tempDir();
    const root = path.join(parent, "proyecto con espacios");
    await mkdir(root);
    const storage = await CommentStorage.init(root);
    await storage.createCollection("../escape").catch(() => undefined);
    expect(await readdir(parent)).toEqual(["proyecto con espacios"]);
    expect((await readdir(root)).sort()).toEqual([".perfect-front"]);
  });

  it("rechaza adjuntos con ruta insegura al leer un documento", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    const file = path.join(root, ".perfect-front", "comments", "inbox", `${c.id}.json`);
    const doc = JSON.parse(await readFile(file, "utf8"));
    doc.attachments = ["attachments/../../secret.png"];
    await writeFile(file, JSON.stringify(doc));
    await expect(storage.getComment(c.id)).rejects.toMatchObject({ code: "invalid_data" });
  });
});

/** Crea un enlace; devuelve false (y avisa) si el SO no lo permite. */
async function tryLink(target: string, link: string, type: "dir" | "junction" | "file"): Promise<boolean> {
  try {
    await symlink(target, link, type);
    return true;
  } catch (e) {
    console.warn(`[comment-storage] se omite prueba de symlink: ${(e as NodeJS.ErrnoException).code}`);
    return false;
  }
}

describe("symlinks que escapan", () => {
  it("una colección enlazada hacia fuera no se lista, ni recibe movimientos", async (ctx) => {
    const { root, storage } = await tempProject();
    const outside = await tempDir("pf outside ");
    const c = await storage.createComment(commentInput());
    const evil = path.join(root, ".perfect-front", "comments", "evil");
    if (!(await tryLink(outside, evil, "junction"))) return ctx.skip();

    expect((await storage.listCollections()).map((x) => x.name)).not.toContain("evil");
    await expect(storage.moveComment(c.id, "evil")).rejects.toBeDefined();
    await expect(storage.createCollection("evil")).rejects.toBeDefined();
    await expect(storage.createComment(commentInput({ collection: "evil" }))).rejects.toBeDefined();
    expect(await readdir(outside)).toEqual([]);
    expect((await storage.getComment(c.id)).collection).toBe("inbox");
  });

  it("no lee comentarios de una carpeta externa enlazada con nombre de colección", async (ctx) => {
    const { root, storage } = await tempProject();
    const outside = await tempDir("pf outside ");
    const other = await storage.createComment(commentInput());
    await writeFile(path.join(outside, `${other.id}.json`), await readFile(path.join(root, ".perfect-front", "comments", "inbox", `${other.id}.json`)));
    await storage.moveComment(other.id, "archived");
    await rename(path.join(root, ".perfect-front", "comments", "archived"), path.join(outside, "moved"));
    if (!(await tryLink(outside, path.join(root, ".perfect-front", "comments", "archived"), "junction"))) return ctx.skip();
    await expect(storage.listComments({ collection: "archived" })).rejects.toBeDefined();
    await expect(storage.getComment(other.id)).rejects.toBeDefined();
  });

  it("un archivo de comentario que es symlink se reporta y no se sigue", async (ctx) => {
    const { root, storage } = await tempProject();
    const outside = await tempDir("pf outside ");
    const secret = path.join(outside, "secret.json");
    await writeFile(secret, JSON.stringify({ version: 1 }));
    const link = path.join(root, ".perfect-front", "comments", "inbox", "pf_SYMBAAAA.json");
    if (!(await tryLink(secret, link, "file"))) return ctx.skip();
    const { comments, errors } = await storage.listComments();
    expect(comments).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(await readFile(secret, "utf8")).toBe(JSON.stringify({ version: 1 }));
  });

  it("rechaza una .perfect-front enlazada fuera de la raíz", async (ctx) => {
    const root = await tempDir();
    const outside = await tempDir("pf outside ");
    if (!(await tryLink(outside, path.join(root, ".perfect-front"), "junction"))) return ctx.skip();
    await expect(CommentStorage.init(root)).rejects.toMatchObject({ code: "invalid_request" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("un attachments/ enlazado hacia fuera impide guardar capturas", async (ctx) => {
    const { root, storage } = await tempProject();
    const outside = await tempDir("pf outside ");
    const att = path.join(root, ".perfect-front", "attachments");
    await rename(att, path.join(root, ".perfect-front", "attachments-old"));
    if (!(await tryLink(outside, att, "junction"))) return ctx.skip();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64");
    await expect(
      storage.createComment(commentInput({ screenshot: { mimeType: "image/png", dataBase64: png } })),
    ).rejects.toBeDefined();
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("límites de tamaño", () => {
  it("rechaza capturas demasiado grandes", async () => {
    const { storage } = await tempProject();
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(7_100_000)]);
    await expect(
      storage.createComment(commentInput({ screenshot: { mimeType: "image/png", dataBase64: big.toString("base64") } })),
    ).rejects.toMatchObject({ code: "payload_too_large" });
  });

  it("un archivo de comentario gigante se reporta sin leerlo", async () => {
    const { root, storage } = await tempProject();
    const ok = await storage.createComment(commentInput());
    await writeFile(path.join(root, ".perfect-front", "comments", "inbox", "pf_HHHHHH.json"), "x".repeat(600 * 1024));
    const { comments, errors } = await storage.listComments();
    expect(comments.map((c) => c.id)).toEqual([ok.id]);
    expect(errors[0]).toMatchObject({ file: "pf_HHHHHH.json", code: "payload_too_large" });
  });

  it("rechaza comentarios sobre el máximo del esquema", async () => {
    const { storage } = await tempProject();
    await expect(storage.createComment(commentInput({ comment: "x".repeat(10_001) }))).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
