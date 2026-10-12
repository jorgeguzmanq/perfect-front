import { describe, expect, it } from "vitest";
import { CreateCommentRequestSchema, composeWithAuto, proposalsToComment, type CommentProposal } from "../src/index";

const text = { id: "p1", kind: "text_fixed", targetSelector: null, before: "Comprar", after: "Comprar ya" } as CommentProposal;
const style = {
  id: "p2",
  kind: "style",
  targetSelector: null,
  appliesTo: "focus",
  changes: [{ property: "color", before: "#aaa", after: "#111", origin: "editable" }],
} as CommentProposal;
const reorder = { id: "p3", kind: "reorder", targetSelector: "ul > li:nth-child(3)", parentSelector: "ul", from: 3, to: 1, siblingCount: 4 } as CommentProposal;

const req = (over: Record<string, unknown>) => ({
  version: 2,
  scope: "view",
  comment: "",
  location: { url: "http://localhost/", route: "/", title: "t", selector: null, selectorCandidates: [], text: null, html: null, componentHint: null },
  viewport: { width: 1, height: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  elementRect: null,
  environment: {},
  ...over,
});

describe("comentario autogenerado", () => {
  it("una línea por propuesta, por secciones", () => {
    expect(proposalsToComment([text])).toBe("Cambiar texto de «Comprar» a «Comprar ya»");
    expect(proposalsToComment([style])).toBe("Cambiar estilo: color #aaa → #111");
    expect(proposalsToComment([reorder])).toBe("Reordenar: ul > li:nth-child(3) pasa de la posición 3 a la 1");
    expect(proposalsToComment([reorder, style, text])).toBe(
      "Texto:\n- Cambiar texto de «Comprar» a «Comprar ya»\n\nEstilos:\n- Cambiar estilo: color #aaa → #111\n\nOrden:\n- Reordenar: ul > li:nth-child(3) pasa de la posición 3 a la 1",
    );
    expect(proposalsToComment([])).toBe("");
  });

  it("la nota se antepone y no se duplica", () => {
    expect(composeWithAuto("  Ojo  ", "AUTO")).toBe("Ojo\n\nAUTO");
    expect(composeWithAuto("", "AUTO")).toBe("AUTO");
    expect(composeWithAuto("ya dice AUTO", "AUTO")).toBe("ya dice AUTO");
  });

  it("el contrato acepta comment vacío solo con propuestas y lo rellena", () => {
    const ok = CreateCommentRequestSchema.safeParse(req({ proposals: [{ ...text, targetSelector: "#a" }] }));
    expect(ok.success && ok.data.comment).toBe("Cambiar texto de «Comprar» a «Comprar ya»");
    expect(CreateCommentRequestSchema.safeParse(req({})).success).toBe(false);
  });
});
