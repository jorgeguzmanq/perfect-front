import { describe, expect, it } from "vitest";
import { CommentProposalSchema, LIMITS, PROPOSAL_KINDS, STYLE_ORIGINS, VisualCommentSchema } from "../src/index";
import { specCommentV2 } from "./fixtures";

const textFixed = () => ({
  id: "p1",
  kind: "text_fixed",
  targetSelector: null,
  before: "Comprar",
  after: "Comprar ahora",
  source: { file: "src/Buy.tsx", line: 12, column: null },
});

const textDynamic = () => ({
  id: "p2",
  kind: "text_dynamic",
  targetSelector: null,
  before: "Quedan {count} plazas",
  after: "Solo quedan {count} plazas",
  variables: { count: "3" },
});

const textI18n = () => ({
  id: "p3",
  kind: "text_i18n",
  targetSelector: null,
  key: "cta.buy",
  library: "i18next",
  uses: 3,
  scope: "all",
  newKey: null,
  locales: [
    { locale: "es", before: "Comprar", after: "Comprar ya" },
    { locale: "en", before: null, after: "Buy now" },
  ],
});

const style = () => ({
  id: "p4",
  kind: "style",
  targetSelector: ".buy",
  appliesTo: "focus",
  changes: [
    {
      property: "border-radius",
      before: "4px",
      after: "8px",
      origin: "editable",
      source: { file: "src/buy.css", line: 12, column: null },
      token: null,
    },
  ],
});

const reorder = () => ({
  id: "p5",
  kind: "reorder",
  targetSelector: "li:nth-child(2)",
  parentSelector: "ul.list",
  from: 2,
  to: 4,
  siblingCount: 5,
});

/** Comentario v2 con las propuestas dadas. */
function withProposals(...proposals: unknown[]) {
  const c = specCommentV2();
  c.proposals = proposals;
  return c;
}

describe("CommentProposalSchema: formas por tipo", () => {
  it("lista los cinco tipos de propuesta", () => {
    expect([...PROPOSAL_KINDS]).toEqual(["text_fixed", "text_dynamic", "text_i18n", "style", "reorder"]);
  });

  it.each([
    ["text_fixed", textFixed],
    ["text_dynamic", textDynamic],
    ["text_i18n", textI18n],
    ["style", style],
    ["reorder", reorder],
  ])("acepta una propuesta %s válida", (_k, make) => {
    expect(CommentProposalSchema.safeParse(make()).success).toBe(true);
  });

  it("rechaza un tipo desconocido", () => {
    expect(CommentProposalSchema.safeParse({ ...textFixed(), kind: "delete" }).success).toBe(false);
  });

  it("text_fixed exige before y after, y respeta el límite de texto", () => {
    const { after: _a, ...noAfter } = textFixed();
    expect(CommentProposalSchema.safeParse(noAfter).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), before: "x".repeat(LIMITS.proposalText + 1) }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), after: "x".repeat(LIMITS.proposalText) }).success).toBe(true);
  });

  it("text_fixed acepta source null o ausente y rechaza file vacío", () => {
    const { source: _s, ...noSource } = textFixed();
    expect(CommentProposalSchema.safeParse(noSource).success).toBe(true);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), source: null }).success).toBe(true);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), source: { file: "", line: 1, column: null } }).success).toBe(false);
  });

  it("note es opcional, admite null y tiene límite", () => {
    expect(CommentProposalSchema.safeParse({ ...textFixed(), note: "Aclaración" }).success).toBe(true);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), note: null }).success).toBe(true);
    expect(CommentProposalSchema.safeParse({ ...textFixed(), note: "n".repeat(LIMITS.text + 1) }).success).toBe(false);
  });

  it("rechaza propiedades extra en cualquier tipo", () => {
    expect(CommentProposalSchema.safeParse({ ...textFixed(), extra: 1 }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...reorder(), extra: 1 }).success).toBe(false);
  });
});

describe("text_dynamic", () => {
  it("las variables deben aparecer en after", () => {
    expect(VisualCommentSchema.safeParse(withProposals(textDynamic())).success).toBe(true);
    expect(VisualCommentSchema.safeParse(withProposals({ ...textDynamic(), after: "Quedan plazas" })).success).toBe(false);
  });

  it("rechaza nombres de variable inválidos y valores demasiado largos", () => {
    expect(CommentProposalSchema.safeParse({ ...textDynamic(), variables: { "1x": "3" } }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...textDynamic(), variables: { count: "v".repeat(201) } }).success).toBe(false);
  });

  it("rechaza más de 20 variables", () => {
    const variables = Object.fromEntries(Array.from({ length: LIMITS.textVariables + 1 }, (_, i) => [`v${i}`, "1"]));
    expect(CommentProposalSchema.safeParse({ ...textDynamic(), variables }).success).toBe(false);
  });
});

describe("text_i18n", () => {
  it("acepta una clave con cambios por idioma (before null = sin traducir)", () => {
    const parsed = CommentProposalSchema.parse(textI18n());
    expect(parsed.kind === "text_i18n" && parsed.locales[1]?.before).toBeNull();
  });

  it("exige al menos un idioma y admite como máximo LIMITS.i18nLocales", () => {
    expect(CommentProposalSchema.safeParse({ ...textI18n(), locales: [] }).success).toBe(false);
    const locales = Array.from({ length: LIMITS.i18nLocales + 1 }, (_, i) => ({
      locale: `a${String.fromCharCode(97 + i)}`,
      before: null,
      after: "x",
    }));
    expect(CommentProposalSchema.safeParse({ ...textI18n(), locales }).success).toBe(false);
  });

  it("rechaza códigos de idioma mal formados", () => {
    const locales = [{ locale: "es_MX", before: null, after: "x" }];
    expect(CommentProposalSchema.safeParse({ ...textI18n(), locales }).success).toBe(false);
  });

  it("rechaza idiomas duplicados", () => {
    const locales = [
      { locale: "es", before: null, after: "a" },
      { locale: "es", before: null, after: "b" },
    ];
    expect(VisualCommentSchema.safeParse(withProposals({ ...textI18n(), locales })).success).toBe(false);
  });

  it("scope one exige newKey", () => {
    expect(VisualCommentSchema.safeParse(withProposals({ ...textI18n(), scope: "one", newKey: null })).success).toBe(false);
    expect(VisualCommentSchema.safeParse(withProposals({ ...textI18n(), scope: "one", newKey: "cta.buy.v2" })).success).toBe(true);
  });

  it("scope solo admite all u one", () => {
    expect(CommentProposalSchema.safeParse({ ...textI18n(), scope: "some" }).success).toBe(false);
  });
});

describe("style: origen editable vs foundation", () => {
  it("STYLE_ORIGINS es editable y foundation", () => {
    expect([...STYLE_ORIGINS]).toEqual(["editable", "foundation"]);
  });

  it("acepta ambos orígenes y los conserva tras parsear", () => {
    const foundation = style();
    foundation.changes[0]!.origin = "foundation";
    (foundation.changes[0] as { token?: string | null }).token = "--pf-radius-md";
    const a = CommentProposalSchema.parse(style());
    const b = CommentProposalSchema.parse(foundation);
    expect(a.kind === "style" && a.changes[0]?.origin).toBe("editable");
    expect(b.kind === "style" && b.changes[0]?.origin).toBe("foundation");
    expect(b.kind === "style" && b.changes[0]?.token).toBe("--pf-radius-md");
  });

  it("rechaza un origen fuera de la lista", () => {
    const s = style();
    (s.changes[0] as Record<string, unknown>).origin = "other";
    expect(CommentProposalSchema.safeParse(s).success).toBe(false);
  });

  it("appliesTo solo admite focus o all", () => {
    expect(CommentProposalSchema.safeParse({ ...style(), appliesTo: "all" }).success).toBe(true);
    expect(CommentProposalSchema.safeParse({ ...style(), appliesTo: "page" }).success).toBe(false);
  });

  it("exige al menos un cambio y admite como máximo LIMITS.styleChanges", () => {
    expect(CommentProposalSchema.safeParse({ ...style(), changes: [] }).success).toBe(false);
    const one = style().changes[0]!;
    const changes = Array.from({ length: LIMITS.styleChanges + 1 }, (_, i) => ({ ...one, property: `p${i}` }));
    expect(CommentProposalSchema.safeParse({ ...style(), changes }).success).toBe(false);
  });

  it("valores before/after respetan styleValue", () => {
    const one = style();
    one.changes[0]!.after = "x".repeat(LIMITS.styleValue + 1);
    expect(CommentProposalSchema.safeParse(one).success).toBe(false);
  });
});

describe("reorder", () => {
  it("acepta una reordenación dentro de siblingCount", () => {
    expect(VisualCommentSchema.safeParse(withProposals(reorder())).success).toBe(true);
  });

  it("from y to deben diferir", () => {
    expect(VisualCommentSchema.safeParse(withProposals({ ...reorder(), to: 2 })).success).toBe(false);
  });

  it("from y to deben caber en siblingCount", () => {
    expect(VisualCommentSchema.safeParse(withProposals({ ...reorder(), to: 6 })).success).toBe(false);
    expect(VisualCommentSchema.safeParse(withProposals({ ...reorder(), from: 6 })).success).toBe(false);
  });

  it("posiciones 1-based y siblingCount entre 1 y 1000", () => {
    expect(CommentProposalSchema.safeParse({ ...reorder(), from: 0 }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...reorder(), siblingCount: 0 }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...reorder(), siblingCount: 1001 }).success).toBe(false);
    expect(CommentProposalSchema.safeParse({ ...reorder(), siblingCount: 1000, to: 1000 }).success).toBe(true);
  });
});

describe("propuestas en el comentario", () => {
  it("targetSelector null es válido con scope element (usa el elemento principal)", () => {
    expect(VisualCommentSchema.safeParse(withProposals(textFixed())).success).toBe(true);
  });

  it("con scope view, cada propuesta exige targetSelector explícito", () => {
    const view = (p: unknown) => {
      const c = withProposals(p);
      c.scope = "view";
      c.location.selector = null;
      c.location.html = null;
      c.elementRect = null;
      return c;
    };
    expect(VisualCommentSchema.safeParse(view(textFixed())).success).toBe(false);
    expect(VisualCommentSchema.safeParse(view({ ...textFixed(), targetSelector: "h1" })).success).toBe(true);
  });

  it("rechaza ids de propuesta duplicados", () => {
    expect(VisualCommentSchema.safeParse(withProposals(textFixed(), { ...textFixed(), after: "otra" })).success).toBe(false);
  });

  it("admite hasta LIMITS.proposals y rechaza una más", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...textFixed(), id: `p${i}` }));
    expect(VisualCommentSchema.safeParse(withProposals(...many(LIMITS.proposals))).success).toBe(true);
    expect(VisualCommentSchema.safeParse(withProposals(...many(LIMITS.proposals + 1))).success).toBe(false);
  });
});
