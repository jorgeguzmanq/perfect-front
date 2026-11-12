// Anotador de fuente: inserta `data-pf-src="ruta:linea:columna"` en cada elemento JSX.
//
// Escaner propio (no babel/oxc): la insercion es SIEMPRE en la misma linea, asi que los
// numeros de linea del archivo no cambian y no hace falta sourcemap. Portado del
// antecesor tune-exp (plugins/jsx-source.mjs) con mejoras: template literals anidados,
// comillas sueltas en texto JSX, `<T extends X>` de TS y Fragment sin anotar.

/** Atributo que lee el overlay (packages/overlay/src/react.ts `sourceAnnotation`). */
export const SOURCE_ATTR = "data-pf-src";

const KEYWORDS_BEFORE_JSX = new Set(["return", "yield", "default", "else", "case", "do", "await", "in", "of", "typeof"]);
const IDENT = /[A-Za-z0-9_$]/;
const NAME_CHAR = /[A-Za-z0-9_$.:-]/;

function isIdent(c: string | undefined): boolean {
  return c !== undefined && IDENT.test(c);
}

/** El `<` de la posicion `i` abre JSX (y no es menor-que ni generico de TS)? */
function opensJsx(code: string, i: number): boolean {
  const next = code[i + 1];
  if (next === undefined || !/[A-Za-z_$]/.test(next)) return false;
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j]!)) j -= 1;
  if (j < 0) return true;
  const prev = code[j]!;
  // `foo()<x`, `arr[0]<x`: comparacion.
  if (prev === ")" || prev === "]") return false;
  if (isIdent(prev)) {
    let k = j;
    while (k >= 0 && isIdent(code[k])) k -= 1;
    return KEYWORDS_BEFORE_JSX.has(code.slice(k + 1, j + 1));
  }
  return "({[=>,:;?&|!+*".includes(prev);
}

export interface AnnotateOptions {
  /** Nombre del atributo (por defecto `data-pf-src`). */
  attr?: string;
}

/** Ruta del archivo relativa a `root`, con `/`. Fuera de la raiz queda absoluta normalizada. */
export function relativeSourcePath(filePath: string, root: string): string {
  const norm = (p: string): string => p.replace(/\\/g, "/");
  const f = norm(filePath);
  const r = norm(root).replace(/\/+$/, "");
  const win = /^[A-Za-z]:/.test(r);
  const fl = win ? f.toLowerCase() : f;
  const rl = win ? r.toLowerCase() : r;
  if (rl && fl.startsWith(rl + "/")) return f.slice(r.length + 1);
  return f;
}

/**
 * Devuelve el codigo con `data-pf-src` en cada elemento JSX, o `null` si no hay nada que anotar.
 * Puro: sin acceso a disco.
 */
export function annotateJsx(code: string, filePath: string, root: string, options: AnnotateOptions = {}): string | null {
  if (!code.includes("<")) return null;
  const attr = options.attr ?? SOURCE_ATTR;
  const rel = relativeSourcePath(filePath, root).replace(/"/g, "%22");
  const inserts: { at: number; text: string }[] = [];
  const n = code.length;

  let line = 1;
  let lineStart = 0;
  let i = 0;
  let braceDepth = 0;
  /** Profundidad de llaves en la que se abrio cada `${` pendiente de cerrar. */
  const templateStack: number[] = [];

  const newline = (at: number): void => {
    line += 1;
    lineStart = at + 1;
  };

  /** Recorre el cuerpo de un template literal desde `i`; termina tras el cierre o tras un `${`. */
  const scanTemplate = (): void => {
    while (i < n) {
      const c = code[i]!;
      if (c === "\\") {
        if (code[i + 1] === "\n") newline(i + 1);
        i += 2;
        continue;
      }
      if (c === "`") {
        i += 1;
        return;
      }
      if (c === "$" && code[i + 1] === "{") {
        templateStack.push(braceDepth);
        braceDepth += 1;
        i += 2;
        return;
      }
      if (c === "\n") newline(i);
      i += 1;
    }
  };

  while (i < n) {
    const c = code[i]!;
    if (c === "\n") {
      newline(i);
      i += 1;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") newline(i);
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      // Una cadena JS no cruza lineas: si llega un salto sin cierre era una comilla suelta
      // (apostrofe en texto JSX) y no se consume el salto.
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = code[j]!;
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "\n") break;
        if (d === c) {
          closed = true;
          break;
        }
        j += 1;
      }
      i = closed ? j + 1 : i + 1;
      continue;
    }
    if (c === "`") {
      i += 1;
      scanTemplate();
      continue;
    }
    if (c === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (c === "}") {
      braceDepth -= 1;
      i += 1;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        scanTemplate();
      }
      continue;
    }
    if (c === "<" && opensJsx(code, i)) {
      let j = i + 1;
      while (j < n && NAME_CHAR.test(code[j]!)) j += 1;
      const name = code.slice(i + 1, j);
      let k = j;
      while (k < n && /\s/.test(code[k]!)) k += 1;
      // Generico de flecha en .tsx: `<T,>(x) => x` / `<T extends X>(x) => x`.
      if (code[k] === "," || /^extends\s+[^=\s]/.test(code.slice(k, k + 40))) {
        i = j;
        continue;
      }
      // Argumento de tipo del elemento (`<Table<Row> prop>`): el atributo va DESPUES del generico.
      let at = j;
      if (code[j] === "<") {
        let depth = 0;
        for (let m = j; m < n; m += 1) {
          const d = code[m];
          if (d === "<") depth += 1;
          else if (d === ">") {
            depth -= 1;
            if (depth === 0) {
              at = m + 1;
              break;
            }
          } else if (d === "\n" || d === "{") break; // no era un generico
        }
      }
      const isFragment = name === "Fragment" || name.endsWith(".Fragment");
      if (!isFragment && name.length > 0) {
        inserts.push({ at, text: ` ${attr}="${rel}:${line}:${i - lineStart + 1}"` });
      }
      i = at > i ? at : i + 1;
      continue;
    }
    i += 1;
  }

  if (inserts.length === 0) return null;
  let out = "";
  let cursor = 0;
  for (const ins of inserts) {
    out += code.slice(cursor, ins.at) + ins.text;
    cursor = ins.at;
  }
  return out + code.slice(cursor);
}
