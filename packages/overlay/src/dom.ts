import type { LocationSource } from '@perfect-front/shared';

/** Crea un elemento con clase y texto opcionales (helper común de los módulos v2). */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `tag#id.clase1.clase2` (máx. 2 clases): etiqueta corta de un elemento. */
export function describe(el: Element): string {
  const id = el.getAttribute('id');
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  return el.localName + (id ? `#${id}` : '') + cls.map((c) => `.${c}`).join('');
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Id local corto (cumple LocalIdSchema): `prefijo-xxxxxx`. */
export function localId(prefix: string, taken?: ReadonlySet<string>): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
    const id = `${prefix}-${s}`;
    if (!taken || !taken.has(id)) return id;
  }
}

/** `archivo:línea[:col]` -> LocationSource (null si no encaja). */
export function parseSrc(src: string | null | undefined): LocationSource | null {
  if (!src) return null;
  const m = /^(.+?):(\d+)(?::(\d+))?$/.exec(src.trim());
  if (!m) return null;
  const line = Number(m[2]);
  if (!Number.isInteger(line) || line <= 0) return null;
  const file = m[1]!.slice(0, 500);
  return m[3] ? { file, line, column: Number(m[3]) } : { file, line };
}

export const fileLabel = (src: string) => src.replace(/^.*[\\/]/, '');
