import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentInput, listNames, tempProject } from "./helpers";

describe("concurrencia", () => {
  it("50 creaciones simultáneas producen IDs únicos y 50 archivos", async () => {
    const { root, storage } = await tempProject();
    const created = await Promise.all(Array.from({ length: 50 }, () => storage.createComment(commentInput())));
    expect(new Set(created.map((c) => c.id)).size).toBe(50);
    const files = await listNames(path.join(root, ".perfect-front", "comments", "inbox"));
    expect(files).toHaveLength(50);
    expect((await storage.listComments()).errors).toEqual([]);
  });

  it("ediciones simultáneas del mismo comentario no se pisan ni corrompen", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => storage.updateComment(c.id, { comment: `edición ${i}` })),
    );
    const final = await storage.getComment(c.id);
    expect(final.comment).toMatch(/^edición \d+$/);
    expect(final.id).toBe(c.id);
    expect((await storage.listComments()).errors).toEqual([]);
  });

  it("movimientos simultáneos a destinos distintos dejan una sola copia", async () => {
    const { root, storage } = await tempProject();
    await Promise.all([storage.createCollection("a"), storage.createCollection("b")]);
    const c = await storage.createComment(commentInput());
    const results = await Promise.allSettled([
      storage.moveComment(c.id, "a"),
      storage.moveComment(c.id, "b"),
      storage.updateComment(c.id, { comment: "mientras tanto" }),
      storage.resolveComment(c.id, { summary: "ok" }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const comments = path.join(root, ".perfect-front", "comments");
    let copies = 0;
    for (const col of await readdir(comments)) {
      copies += (await readdir(path.join(comments, col))).filter((f) => f === `${c.id}.json`).length;
    }
    expect(copies).toBe(1);
    const final = await storage.getComment(c.id);
    const onDisk = JSON.parse(
      await readFile(path.join(comments, final.collection, `${c.id}.json`), "utf8"),
    );
    expect(onDisk.collection).toBe(final.collection);
    expect(await listNames(path.join(root, ".perfect-front", ".tmp"))).toEqual([]);
  });
});

describe("corrupción y duplicados", () => {
  it("JSON corrupto se reporta sin bloquear el listado", async () => {
    const { root, storage } = await tempProject();
    const ok = await storage.createComment(commentInput());
    const bad = await storage.createComment(commentInput());
    const inbox = path.join(root, ".perfect-front", "comments", "inbox");
    await writeFile(path.join(inbox, `${bad.id}.json`), '{"version": 1, "id": ');
    await writeFile(path.join(inbox, "pf_AAAAAA.json"), JSON.stringify({ version: 1 }));
    await writeFile(path.join(inbox, "pf_BBBBBB.json"), JSON.stringify({ version: 99 }));
    await writeFile(path.join(inbox, "notes.json"), "{}");
    await writeFile(path.join(inbox, "readme.txt"), "ignorado");

    const { comments, errors } = await storage.listComments();
    expect(comments.map((c) => c.id)).toEqual([ok.id]);
    expect(errors.map((e) => e.file).sort()).toEqual(
      [`${bad.id}.json`, "notes.json", "pf_AAAAAA.json", "pf_BBBBBB.json"].sort(),
    );
    expect(errors.find((e) => e.file === "pf_BBBBBB.json")?.code).toBe("unsupported_version");
    // los mensajes no exponen rutas absolutas
    expect(JSON.stringify(errors)).not.toContain(root);
    await expect(storage.getComment(bad.id)).rejects.toMatchObject({ code: "invalid_data" });
  });

  it("el ID del documento debe coincidir con el archivo", async () => {
    const { root, storage } = await tempProject();
    const a = await storage.createComment(commentInput());
    const b = await storage.createComment(commentInput());
    const inbox = path.join(root, ".perfect-front", "comments", "inbox");
    await copyFile(path.join(inbox, `${a.id}.json`), path.join(inbox, `${b.id}.json`));
    const { comments, errors } = await storage.listComments();
    expect(comments.map((c) => c.id)).toEqual([a.id]);
    expect(errors).toHaveLength(1);
    await expect(storage.getComment(b.id)).rejects.toMatchObject({ code: "invalid_data" });
  });

  it("un ID presente en dos colecciones se detecta como conflicto", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    const comments = path.join(root, ".perfect-front", "comments");
    await copyFile(path.join(comments, "inbox", `${c.id}.json`), path.join(comments, "archived", `${c.id}.json`));
    await expect(storage.getComment(c.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(storage.moveComment(c.id, "resolved")).rejects.toMatchObject({ code: "conflict" });
    const { comments: listed, errors } = await storage.listComments();
    expect(listed).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("no pisa un archivo existente al mover", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(commentInput());
    const comments = path.join(root, ".perfect-front", "comments");
    await writeFile(path.join(comments, "resolved", `${c.id}.json`), "ocupado");
    // el duplicado se detecta antes de tocar nada
    await expect(storage.moveComment(c.id, "resolved")).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(path.join(comments, "resolved", `${c.id}.json`), "utf8")).toBe("ocupado");
  });
});
