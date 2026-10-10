import path from "node:path";
import { describe, expect, it } from "vitest";
import { STORAGE_LIMITS } from "../src/index";
import { PNG_B64, commentInput, listNames, tempProject } from "./helpers";

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const WEBP_B64 = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]).toString("base64");
const NOT_IMAGE_B64 = Buffer.from("esto no es una imagen").toString("base64");

function v2(over: Record<string, unknown> = {}): Record<string, unknown> {
  return commentInput({ version: 2, ...over });
}

function upload(clientId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId,
    mimeType: "image/png",
    dataBase64: PNG_B64,
    name: `${clientId}.png`,
    source: "paste",
    sectionId: null,
    ...over,
  };
}

async function attachmentsOf(root: string): Promise<string[]> {
  return listNames(path.join(root, ".perfect-front", "attachments"));
}

describe("creación v2 con subidas y secciones", () => {
  it("guarda cada imagen con su extensión, la ata a su sección y registra metadatos", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(
      v2({
        sections: [
          { id: "antes", title: "Antes", text: "Así se ve" },
          { id: "despues", title: null, text: "" },
        ],
        uploads: [
          upload("a", { sectionId: "antes", source: "paste" }),
          upload("b", { sectionId: "despues", mimeType: "image/jpeg", dataBase64: JPEG_B64, name: "foto.jpg", source: "drop" }),
          upload("c", { mimeType: "image/webp", dataBase64: WEBP_B64, name: "suelta.webp", source: "open" }),
        ],
      }),
    );

    expect(c.version).toBe(2);
    expect(c.attachments).toEqual([`attachments/${c.id}.png`, `attachments/${c.id}-1.jpg`, `attachments/${c.id}-2.webp`]);
    expect(c.sections[0]?.attachments).toEqual([`attachments/${c.id}.png`]);
    expect(c.sections[1]?.attachments).toEqual([`attachments/${c.id}-1.jpg`]);
    expect(c.attachmentInfo).toEqual([
      { path: `attachments/${c.id}.png`, name: "a.png", source: "paste", mimeType: "image/png", bytes: 11 },
      { path: `attachments/${c.id}-1.jpg`, name: "foto.jpg", source: "drop", mimeType: "image/jpeg", bytes: 7 },
      { path: `attachments/${c.id}-2.webp`, name: "suelta.webp", source: "open", mimeType: "image/webp", bytes: 13 },
    ]);
  });

  it("los archivos existen en attachments/ y el comentario se relee igual", async () => {
    const { root, storage } = await tempProject();
    const c = await storage.createComment(v2({ uploads: [upload("a"), upload("b")] }));
    expect(await attachmentsOf(root)).toEqual([`${c.id}-1.png`, `${c.id}.png`].sort());
    expect(await storage.getComment(c.id)).toEqual(c);
  });

  it("sin subidas ni secciones deja listas vacías", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(v2());
    expect(c.attachments).toEqual([]);
    expect(c.attachmentInfo).toEqual([]);
    expect(c.sections).toEqual([]);
  });

  it("guarda extraTargets, propuestas y grupo junto al comentario", async () => {
    const { storage } = await tempProject();
    const c = await storage.createComment(
      v2({
        group: null,
        proposals: [
          {
            id: "p1",
            kind: "text_fixed",
            targetSelector: null,
            before: "Comprar",
            after: "Comprar ahora",
          },
        ],
      }),
    );
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0]).toMatchObject({ kind: "text_fixed", after: "Comprar ahora" });
    expect(c.extraTargets).toEqual([]);
    expect(c.group).toBeNull();
  });
});

describe("rollback de subidas", () => {
  it("si la segunda imagen es inválida, borra la primera y no crea el comentario", async () => {
    const { root, storage } = await tempProject();
    await expect(
      storage.createComment(v2({ uploads: [upload("a"), upload("b", { dataBase64: NOT_IMAGE_B64 })] })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await attachmentsOf(root)).toEqual([]);
    expect((await storage.listComments()).comments).toEqual([]);
  });

  it("un MIME que no coincide con los bytes falla y no deja archivos", async () => {
    const { root, storage } = await tempProject();
    await expect(
      storage.createComment(v2({ uploads: [upload("a"), upload("b", { mimeType: "image/png", dataBase64: JPEG_B64 })] })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await attachmentsOf(root)).toEqual([]);
  });

  it("una imagen sobre el límite por adjunto falla con payload_too_large y no deja archivos", async () => {
    const { root, storage } = await tempProject();
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(STORAGE_LIMITS.attachment)]);
    await expect(
      storage.createComment(v2({ uploads: [upload("a"), upload("b", { dataBase64: big.toString("base64") })] })),
    ).rejects.toMatchObject({ code: "payload_too_large" });
    expect(await attachmentsOf(root)).toEqual([]);
  });

  it("una subida con sectionId inexistente se rechaza antes de escribir nada", async () => {
    const { root, storage } = await tempProject();
    await expect(
      storage.createComment(
        v2({
          sections: [{ id: "antes", title: null, text: "" }],
          uploads: [upload("a", { sectionId: "antes" }), upload("b", { sectionId: "no-existe" })],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await attachmentsOf(root)).toEqual([]);
  });

  it("21 subidas se rechazan antes de escribir nada", async () => {
    const { root, storage } = await tempProject();
    const uploads = Array.from({ length: 21 }, (_, i) => upload(`u${i}`));
    await expect(storage.createComment(v2({ uploads }))).rejects.toMatchObject({ code: "invalid_request" });
    expect(await attachmentsOf(root)).toEqual([]);
  });

  it("tras un fallo, una creación correcta sigue funcionando y no reutiliza nombres ajenos", async () => {
    const { root, storage } = await tempProject();
    await expect(
      storage.createComment(v2({ uploads: [upload("a"), upload("b", { dataBase64: NOT_IMAGE_B64 })] })),
    ).rejects.toBeDefined();
    const ok = await storage.createComment(v2({ uploads: [upload("a")] }));
    expect(await attachmentsOf(root)).toEqual([`${ok.id}.png`]);
  });
});
