import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { annotateJsx, perfectFrontSource, relativeSourcePath, writeWrapperConfig } from "../src";

const ROOT = "/proj";
const FILE = "/proj/src/App.tsx";
const ann = (code: string) => annotateJsx(code, FILE, ROOT);
const srcs = (out: string | null) => [...(out ?? "").matchAll(/data-pf-src="([^"]+)"/g)].map((m) => m[1]);

describe("annotateJsx", () => {
  it("anota con ruta relativa, línea y columna (formato que lee el overlay)", () => {
    const out = ann("const a = (\n  <div className=\"x\">\n    <span />\n  </div>\n);");
    expect(srcs(out)).toEqual(["src/App.tsx:2:3", "src/App.tsx:3:5"]);
    expect(out).toContain('<div data-pf-src="src/App.tsx:2:3" className="x">');
  });

  it("no cambia el número de líneas", () => {
    const code = "function A() {\n  return (\n    <>\n      <p>\n        hola\n      </p>\n    </>\n  );\n}\n";
    const out = ann(code)!;
    expect(out.split("\n").length).toBe(code.split("\n").length);
    expect(srcs(out)).toEqual(["src/App.tsx:4:7"]);
  });

  it("devuelve null sin JSX", () => {
    expect(ann("const a = 1;")).toBeNull();
    expect(ann("if (a < b && c > d) {}")).toBeNull();
  });

  it("no anota fragmentos ni Fragment", () => {
    expect(ann("const a = <></>;")).toBeNull();
    expect(ann("const a = <Fragment key=\"k\"><i/></Fragment>;")).toContain('<i data-pf-src');
    expect(ann("const a = <React.Fragment><i/></React.Fragment>;")).not.toContain("Fragment data-pf-src");
  });

  it("respeta comparaciones y genéricos TS", () => {
    const code = [
      "const [s, setS] = useState<string>('');",
      "const m = new Map<string, number>();",
      "const ok = i < n && arr[0]<x;",
      "function f<T>(x: T): T { return x; }",
      "const g = <T,>(x: T) => x;",
      "const h = <T extends object>(x: T) => x;",
      "const el = <div />;",
    ].join("\n");
    expect(srcs(ann(code))).toEqual(["src/App.tsx:7:12"]);
  });

  it("inserta el atributo después del argumento de tipo del elemento", () => {
    const out = ann("const t = <Table<Row> rows={r} />;")!;
    expect(out).toContain('<Table<Row> data-pf-src="src/App.tsx:1:11" rows={r} />');
  });

  it("atributos spread y expresiones con JSX anidado", () => {
    const out = ann("const a = <Btn {...props} onClick={() => <b>x</b>} />;")!;
    expect(srcs(out)).toHaveLength(2);
    expect(out).toContain("<Btn data-pf-src=");
    expect(out).toContain("{...props}");
  });

  it("ignora < dentro de strings, comentarios y templates", () => {
    const code = [
      "const a = '<div>';",
      'const b = "<span>";',
      "// <p>",
      "/* <p>\n <i> */",
      "const c = `x <b> ${1 < 2 ? 'y' : 'z'}`;",
      "const d = <em />;",
    ].join("\n");
    expect(srcs(ann(code))).toEqual(["src/App.tsx:7:11"]);
  });

  it("template con JSX dentro de ${} y vuelve al template", () => {
    const code = "const a = `${<b/>} y <i>`;\nconst z = <u />;";
    expect(srcs(ann(code))).toEqual(["src/App.tsx:1:14", "src/App.tsx:2:11"]);
  });

  it("apóstrofes sueltos en texto JSX no desfasan las líneas", () => {
    const code = "const a = (\n  <p>don't stop</p>\n);\nconst b = <i />;";
    expect(srcs(ann(code))).toEqual(["src/App.tsx:2:3", "src/App.tsx:4:11"]);
  });

  it("funciona en .jsx con comparaciones en props", () => {
    const out = annotateJsx("export const A = ({n}) => n < 3 ? <a href=\"/\" /> : null;", "/proj/A.jsx", ROOT)!;
    expect(srcs(out)).toEqual(["A.jsx:1:35"]);
  });
});

describe("relativeSourcePath", () => {
  it("relativiza con / y es insensible a mayúsculas en unidades de Windows", () => {
    expect(relativeSourcePath("Z:\\Dev\\app\\src\\A.tsx", "z:\\dev\\app")).toBe("src/A.tsx");
    expect(relativeSourcePath("/otro/A.tsx", "/proj")).toBe("/otro/A.tsx");
  });
});

describe("perfectFrontSource", () => {
  const plugin = perfectFrontSource({ root: ROOT });
  it("solo .jsx/.tsx fuera de node_modules", () => {
    expect(plugin.transform("const a = <b/>;", "/proj/src/a.ts")).toBeNull();
    expect(plugin.transform("const a = <b/>;", "/proj/node_modules/x/a.tsx")).toBeNull();
    expect(plugin.transform("const a = <b/>;", "/proj/src/a.tsx?t=1")?.code).toContain("data-pf-src");
  });
  it("no hace nada en build", () => {
    const p = perfectFrontSource({ root: ROOT });
    p.configResolved({ command: "build" });
    expect(p.transform("const a = <b/>;", "/proj/src/a.tsx")).toBeNull();
    expect(p.enforce).toBe("pre");
  });
});

describe("writeWrapperConfig", () => {
  it("escribe en el state-dir, no en el proyecto, e importa la config original", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-src-"));
    const project = path.join(tmp, "app");
    const state = path.join(tmp, "state");
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, "vite.config.ts"), "export default {};");
    const file = writeWrapperConfig({ stateDir: state, projectDir: project });
    expect(file.startsWith(path.join(state, "wrappers"))).toBe(true);
    expect(path.basename(file)).toBe("vite.pf.config.mjs");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("vite.config.ts");
    expect(text).toContain("perfectFrontSource");
    expect(fs.readdirSync(project)).toEqual(["vite.config.ts"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("sin vite.config usa una base vacía", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-src-"));
    fs.mkdirSync(path.join(tmp, "app"));
    const file = writeWrapperConfig({ stateDir: path.join(tmp, "s"), projectDir: path.join(tmp, "app") });
    expect(fs.readFileSync(file, "utf8")).toContain("const base = {};");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
