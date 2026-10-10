import { describe, expect, it } from "vitest";
import { LOCATION_REF_FORMATS, LocationRefFormatSchema, formatLocationRef, type LocationRefInput } from "../src/index";

const ref: LocationRefInput = {
  route: "/pricing",
  selector: "main > section.pricing button.buy",
  source: { file: "src/Buy.tsx", line: 12, column: null },
  label: "button.buy",
};

describe("formatos de «copiar ubicación»", () => {
  it("lista los cuatro formatos", () => {
    expect([...LOCATION_REF_FORMATS]).toEqual(["file", "selector", "pf", "markdown"]);
    expect(LocationRefFormatSchema.safeParse("json").success).toBe(false);
  });

  it("file: archivo:línea cuando hay línea", () => {
    expect(formatLocationRef("file", ref)).toBe("src/Buy.tsx:12");
  });

  it("file: solo archivo cuando la línea es null", () => {
    expect(formatLocationRef("file", { ...ref, source: { file: "src/Buy.tsx", line: null } })).toBe("src/Buy.tsx");
  });

  it("file: null sin origen (source null o ausente)", () => {
    expect(formatLocationRef("file", { ...ref, source: null })).toBeNull();
    expect(formatLocationRef("file", { route: "/", selector: "h1", source: undefined })).toBeNull();
  });

  it("selector: devuelve el selector tal cual o null", () => {
    expect(formatLocationRef("selector", ref)).toBe("main > section.pricing button.buy");
    expect(formatLocationRef("selector", { ...ref, selector: null })).toBeNull();
  });

  it("pf: ruta sin barra inicial y último tramo del selector", () => {
    expect(formatLocationRef("pf", ref)).toBe("pf://pricing#section.pricing button.buy");
  });

  it("pf: null sin selector", () => {
    expect(formatLocationRef("pf", { ...ref, selector: null })).toBeNull();
  });

  it("markdown: archivo:línea y etiqueta entre código, con la ruta", () => {
    expect(formatLocationRef("markdown", ref)).toBe("`src/Buy.tsx:12` · `button.buy` en /pricing");
  });

  it("markdown: usa el selector si no hay etiqueta", () => {
    expect(formatLocationRef("markdown", { ...ref, label: null })).toBe(
      "`src/Buy.tsx:12` · `main > section.pricing button.buy` en /pricing",
    );
  });

  it("markdown: sin línea muestra solo el archivo", () => {
    expect(formatLocationRef("markdown", { ...ref, source: { file: "src/Buy.tsx", line: null } })).toBe(
      "`src/Buy.tsx` · `button.buy` en /pricing",
    );
  });

  it("markdown: sin origen usa solo la etiqueta o el selector", () => {
    expect(formatLocationRef("markdown", { ...ref, source: null })).toBe("`button.buy` en /pricing");
    expect(formatLocationRef("markdown", { ...ref, source: null, label: null })).toBe(
      "`main > section.pricing button.buy` en /pricing",
    );
  });

  it("markdown: null si no hay ni origen, ni etiqueta, ni selector", () => {
    expect(formatLocationRef("markdown", { route: "/", selector: null, source: null })).toBeNull();
  });

  it("markdown: sustituye comillas invertidas para no romper el código inline", () => {
    expect(formatLocationRef("markdown", { ...ref, label: "a`b" })).toContain("`a'b`");
  });
});
