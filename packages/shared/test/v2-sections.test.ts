import { describe, expect, it } from "vitest";
import {
  CommentSectionSchema,
  CreateCommentRequestSchema,
  LIMITS,
  NewSectionSchema,
  UpdateCommentRequestSchema,
  VisualCommentSchema,
} from "../src/index";
import { specCommentV2 } from "./fixtures";

const ATT = "attachments/pf_01K7A.png";

/** Cuerpo mínimo válido de creación v2 (sin secciones ni subidas). */
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

function upload(clientId: string, sectionId: string | null = null) {
  return {
    clientId,
    mimeType: "image/png",
    dataBase64: "iVBORw0KGgo=",
    name: `${clientId}.png`,
    source: "paste",
    sectionId,
  };
}

describe("CommentSectionSchema", () => {
  it("acepta una sección con título nulo, texto vacío y sin adjuntos", () => {
    expect(CommentSectionSchema.safeParse({ id: "s1", title: null, text: "", attachments: [] }).success).toBe(true);
  });

  it("acepta una sección con título, texto y adjuntos válidos", () => {
    const s = { id: "antes", title: "Antes", text: "Así se ve hoy", attachments: [ATT] };
    expect(CommentSectionSchema.parse(s)).toEqual(s);
  });

  it("respeta los límites de título y texto", () => {
    const base = { id: "s1", attachments: [] };
    expect(CommentSectionSchema.safeParse({ ...base, title: "t".repeat(LIMITS.sectionTitle), text: "" }).success).toBe(true);
    expect(CommentSectionSchema.safeParse({ ...base, title: "t".repeat(LIMITS.sectionTitle + 1), text: "" }).success).toBe(false);
    expect(CommentSectionSchema.safeParse({ ...base, title: null, text: "x".repeat(LIMITS.sectionText) }).success).toBe(true);
    expect(CommentSectionSchema.safeParse({ ...base, title: null, text: "x".repeat(LIMITS.sectionText + 1) }).success).toBe(false);
  });

  it.each([
    ["id con traversal", { id: "../x", title: null, text: "", attachments: [] }],
    ["id vacío", { id: "", title: null, text: "", attachments: [] }],
    ["adjunto inseguro", { id: "s1", title: null, text: "", attachments: ["attachments/../../x.png"] }],
    ["propiedad extra", { id: "s1", title: null, text: "", attachments: [], extra: 1 }],
    ["sin texto", { id: "s1", title: null, attachments: [] }],
  ])("rechaza %s", (_n, value) => {
    expect(CommentSectionSchema.safeParse(value).success).toBe(false);
  });

  it("la forma de creación (NewSectionSchema) no admite attachments", () => {
    expect(NewSectionSchema.safeParse({ id: "s1", title: "A", text: "b" }).success).toBe(true);
    expect(NewSectionSchema.safeParse({ id: "s1", title: "A", text: "b", attachments: [] }).success).toBe(false);
  });
});

describe("secciones en VisualComment", () => {
  it("acepta una sección que referencia un adjunto existente", () => {
    const c = specCommentV2();
    c.sections = [{ id: "antes", title: "Antes", text: "", attachments: [ATT] }];
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza una sección que referencia un adjunto inexistente", () => {
    const c = specCommentV2();
    c.sections = [{ id: "antes", title: null, text: "", attachments: ["attachments/pf_NOEXISTE.png"] }];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("un adjunto no puede estar en dos secciones", () => {
    const c = specCommentV2();
    c.sections = [
      { id: "a", title: null, text: "", attachments: [ATT] },
      { id: "b", title: null, text: "", attachments: [ATT] },
    ];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("rechaza ids de sección duplicados", () => {
    const c = specCommentV2();
    c.sections = [
      { id: "a", title: null, text: "1", attachments: [] },
      { id: "a", title: null, text: "2", attachments: [] },
    ];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("acepta hasta 20 secciones y rechaza la 21", () => {
    const sections = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: null, text: "", attachments: [] }));
    const ok = specCommentV2();
    ok.sections = sections(LIMITS.sections);
    expect(VisualCommentSchema.safeParse(ok).success).toBe(true);
    const ko = specCommentV2();
    ko.sections = sections(LIMITS.sections + 1);
    expect(VisualCommentSchema.safeParse(ko).success).toBe(false);
  });

  it("una sección sin adjuntos no quita el adjunto de la lista canónica attachments", () => {
    const c = specCommentV2();
    c.sections = [{ id: "a", title: null, text: "", attachments: [] }];
    const parsed = VisualCommentSchema.parse(c);
    expect(parsed.attachments).toEqual([ATT]);
  });
});

describe("secciones en la creación", () => {
  it("acepta secciones y subidas atadas por sectionId", () => {
    const body = createBody({
      sections: [{ id: "antes", title: "Antes", text: "" }],
      uploads: [upload("a", "antes"), upload("b", null)],
    });
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rechaza una subida con sectionId inexistente", () => {
    const body = createBody({
      sections: [{ id: "antes", title: "Antes", text: "" }],
      uploads: [upload("a", "despues")],
    });
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rechaza más de 20 secciones en la creación", () => {
    const sections = Array.from({ length: LIMITS.sections + 1 }, (_, i) => ({ id: `s${i}`, title: null, text: "" }));
    expect(CreateCommentRequestSchema.safeParse(createBody({ sections })).success).toBe(false);
  });

  it("rechaza ids de sección duplicados en la creación", () => {
    const sections = [
      { id: "a", title: null, text: "" },
      { id: "a", title: null, text: "" },
    ];
    expect(CreateCommentRequestSchema.safeParse(createBody({ sections })).success).toBe(false);
  });

  it("la creación sin secciones usa lista vacía por defecto", () => {
    const parsed = CreateCommentRequestSchema.parse(createBody());
    expect(parsed.sections).toEqual([]);
    expect(parsed.uploads).toEqual([]);
  });
});

describe("secciones en el PATCH", () => {
  it("sections reemplaza la lista completa y acepta lista vacía", () => {
    expect(
      UpdateCommentRequestSchema.safeParse({ sections: [{ id: "a", title: null, text: "x", attachments: [ATT] }] }).success,
    ).toBe(true);
    expect(UpdateCommentRequestSchema.safeParse({ sections: [] }).success).toBe(true);
  });

  it("rechaza sections con más de 20 elementos", () => {
    const sections = Array.from({ length: LIMITS.sections + 1 }, (_, i) => ({
      id: `s${i}`,
      title: null,
      text: "",
      attachments: [],
    }));
    expect(UpdateCommentRequestSchema.safeParse({ sections }).success).toBe(false);
  });

  it("un PATCH con solo secciones no está vacío", () => {
    expect(UpdateCommentRequestSchema.safeParse({}).success).toBe(false);
  });
});
