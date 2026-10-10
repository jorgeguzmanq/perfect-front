import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_SOURCES,
  AttachmentInfoSchema,
  AttachmentPathSchema,
  AttachmentUploadSchema,
  CreateCommentRequestSchema,
  LIMITS,
  UpdateCommentRequestSchema,
  VisualCommentSchema,
} from "../src/index";
import { specCommentV2 } from "./fixtures";

const PNG_B64 = "iVBORw0KGgo=";

function createBody(over: Record<string, unknown> = {}) {
  const c = specCommentV2();
  return {
    version: 2,
    scope: c.scope,
    comment: c.comment,
    location: c.location,
    viewport: c.viewport,
    elementRect: c.elementRect,
    environment: c.environment,
    ...over,
  };
}

function upload(clientId: string, over: Record<string, unknown> = {}) {
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

function paths(n: number, prefix = "pf_01K7A"): string[] {
  return Array.from({ length: n }, (_, i) => `attachments/${prefix}-${i}.png`);
}

describe("adjuntos por comentario (máximo 20)", () => {
  it("LIMITS.attachments es 20", () => {
    expect(LIMITS.attachments).toBe(20);
  });

  it("acepta un comentario con 20 adjuntos", () => {
    const c = specCommentV2();
    c.attachments = paths(20);
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza un comentario con 21 adjuntos", () => {
    const c = specCommentV2();
    c.attachments = paths(21);
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("rechaza adjuntos duplicados", () => {
    const c = specCommentV2();
    c.attachments = ["attachments/pf_01K7A.png", "attachments/pf_01K7A.png"];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("la creación acepta 20 subidas", () => {
    const uploads = Array.from({ length: 20 }, (_, i) => upload(`u${i}`));
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads })).success).toBe(true);
  });

  it("la creación rechaza 21 subidas", () => {
    const uploads = Array.from({ length: 21 }, (_, i) => upload(`u${i}`));
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads })).success).toBe(false);
  });

  it("la captura heredada (screenshot) cuenta como adjunto: 20 subidas + captura = 21 se rechaza", () => {
    const uploads = Array.from({ length: 20 }, (_, i) => upload(`u${i}`));
    const screenshot = { mimeType: "image/png", dataBase64: PNG_B64 };
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads, screenshot })).success).toBe(false);
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads: uploads.slice(0, 19), screenshot })).success).toBe(true);
  });

  it("el PATCH rechaza más de 20 subidas", () => {
    const uploads = Array.from({ length: 21 }, (_, i) => upload(`u${i}`));
    expect(UpdateCommentRequestSchema.safeParse({ uploads }).success).toBe(false);
  });

  it("rechaza clientId duplicados en las subidas", () => {
    const uploads = [upload("a"), upload("a")];
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads })).success).toBe(false);
  });

  it("rechaza subidas cuyo base64 total supera el límite de la request", () => {
    const big = "A".repeat(6_600_000);
    const uploads = [upload("a", { dataBase64: big }), upload("b", { dataBase64: big })];
    expect(CreateCommentRequestSchema.safeParse(createBody({ uploads })).success).toBe(false);
  });
});

describe("AttachmentPathSchema", () => {
  it.each(["attachments/pf_01K7A.png", "attachments/a-1.webp"])("acepta %s", (p) => {
    expect(AttachmentPathSchema.safeParse(p).success).toBe(true);
  });

  it.each([
    "attachments/../../secret.png",
    "../attachments/x.png",
    "pf_01K7A.png",
    "attachments/con.png",
    "attachments/",
    "attachments/.oculto.png",
    "attachments/a/b.png",
  ])("rechaza %s", (p) => {
    expect(AttachmentPathSchema.safeParse(p).success).toBe(false);
  });
});

describe("AttachmentUploadSchema", () => {
  const valid = { clientId: "u1", mimeType: "image/png", dataBase64: PNG_B64, name: "captura.png", source: "paste", sectionId: null };

  it("acepta una subida válida, con o sin sección", () => {
    expect(AttachmentUploadSchema.safeParse(valid).success).toBe(true);
    expect(AttachmentUploadSchema.safeParse({ ...valid, sectionId: "antes" }).success).toBe(true);
  });

  it.each(ATTACHMENT_SOURCES)("acepta el origen %s", (source) => {
    expect(AttachmentUploadSchema.safeParse({ ...valid, source }).success).toBe(true);
  });

  it.each([
    ["mime no admitido (gif)", { mimeType: "image/gif" }],
    ["mime svg", { mimeType: "image/svg+xml" }],
    ["origen desconocido", { source: "file" }],
    ["nombre vacío", { name: "" }],
    ["nombre demasiado largo", { name: "n".repeat(LIMITS.attachmentName + 1) }],
    ["base64 con caracteres inválidos", { dataBase64: "!!!" }],
    ["clientId vacío", { clientId: "" }],
    ["sectionId con traversal", { sectionId: "../x" }],
    ["propiedad extra", { extra: true }],
  ])("rechaza %s", (_n, over) => {
    expect(AttachmentUploadSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });
});

describe("AttachmentInfoSchema (metadatos)", () => {
  const info = { path: "attachments/pf_01K7A.png", name: "captura.png", source: "drop", mimeType: "image/png", bytes: 2048 };

  it("acepta metadatos válidos", () => {
    expect(AttachmentInfoSchema.parse(info)).toEqual(info);
  });

  it("rechaza bytes negativos, bytes fraccionarios y mime no admitido", () => {
    expect(AttachmentInfoSchema.safeParse({ ...info, bytes: -1 }).success).toBe(false);
    expect(AttachmentInfoSchema.safeParse({ ...info, bytes: 1.5 }).success).toBe(false);
    expect(AttachmentInfoSchema.safeParse({ ...info, mimeType: "image/bmp" }).success).toBe(false);
  });

  it("metadatos de un adjunto que no está en attachments se rechazan en el comentario", () => {
    const c = specCommentV2();
    c.attachments = [];
    c.attachmentInfo = [info];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("metadatos duplicados se rechazan en el comentario", () => {
    const c = specCommentV2();
    c.attachmentInfo = [info, { ...info }];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("metadatos coherentes con attachments se aceptan", () => {
    const c = specCommentV2();
    c.attachmentInfo = [info];
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });
});
