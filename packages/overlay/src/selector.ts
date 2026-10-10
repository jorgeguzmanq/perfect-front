import { LIMITS } from '@perfect-front/shared';

/** Escapa un identificador CSS (equivalente a CSS.escape, sin depender del entorno). */
export function cssEscape(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) out += '�';
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else if (/[0-9]/.test(ch) && (i === 0 || (i === 1 && value.charAt(0) === '-'))) out += `\\${code.toString(16)} `;
    else if (ch === '-' && value.length === 1) out += '\\-';
    else if (/[A-Za-z0-9_-]/.test(ch) || code > 0x7f) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

const attrValue = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;

/** Ids/clases típicas de generadores: React useId, hashes, CSS-in-JS, CSS Modules con hash. */
export function looksGenerated(name: string): boolean {
  return (
    /^:r?[a-z0-9]+:$/i.test(name) ||
    /^(css|sc|jsx|svelte|emotion|styled|astro)-[a-z0-9]{4,}/i.test(name) ||
    /__[A-Za-z0-9_-]{5,}$/.test(name) ||
    /[a-f0-9]{8,}/i.test(name) ||
    /\d{4,}/.test(name) ||
    (/^_?[A-Za-z0-9]{5,8}$/.test(name) && /[A-Z]/.test(name) && /\d/.test(name))
  );
}

const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-e2e'];
const STABLE_ATTRS = ['aria-label', 'name', 'role', 'type', 'placeholder', 'alt', 'title', 'for', 'href'];

function isUnique(root: ParentNode, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function stableClasses(el: Element): string[] {
  return (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((c) => c && c.length <= 40 && !looksGenerated(c) && !/[:/[\]%.]/.test(c))
    .slice(0, 3);
}

/** Selectores locales (sin ancestros), del más estable al menos estable. */
function localSelectors(el: Element): string[] {
  const tag = el.localName;
  const out: string[] = [];
  const id = el.getAttribute('id');
  if (id && !looksGenerated(id)) out.push(`#${cssEscape(id)}`);
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) out.push(`[${a}=${attrValue(v)}]`);
  }
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (!v || v.length > 80) continue;
    if (a === 'href' && /^\s*javascript:/i.test(v)) continue;
    out.push(`${tag}[${a}=${attrValue(v)}]`);
  }
  const classes = stableClasses(el);
  if (classes.length) {
    out.push(`${tag}${classes.map((c) => '.' + cssEscape(c)).join('')}`);
    if (classes.length > 1) out.push(`${tag}.${cssEscape(classes[0]!)}`);
  }
  return out;
}

function nthOfType(el: Element): string {
  const parent = el.parentElement;
  const tag = el.localName;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.localName === tag);
  return same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
}

function nthChild(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return el.localName;
  return `${el.localName}:nth-child(${Array.from(parent.children).indexOf(el) + 1})`;
}

/** Ruta desde el ancestro más cercano con ancla estable (o `html`). */
function path(el: Element, step: (e: Element) => string, useAnchors: boolean): string {
  const parts: string[] = [];
  const doc = el.ownerDocument;
  let cur: Element | null = el;
  while (cur) {
    if (useAnchors && cur !== el) {
      const node: Element = cur;
      const anchor = localSelectors(node).find(
        (s) => (s.startsWith('#') || s.startsWith('[data-')) && isUnique(doc, s, node),
      );
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
    }
    parts.unshift(step(cur));
    if (cur === doc.documentElement) break;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

/**
 * Genera varios selectores candidatos y garantiza que cada uno resuelve a `el` y solo a `el`.
 * Orden: id / data-testid / atributos estables / clases estables / padre+local / ruta anclada / estructural.
 * Los nth-child solo aparecen al final.
 */
export function generateSelectorCandidates(el: Element): string[] {
  const doc = el.ownerDocument;
  const found: string[] = [];
  const add = (s: string) => {
    if (s && s.length <= LIMITS.selector && !found.includes(s) && isUnique(doc, s, el)) found.push(s);
  };

  const own = localSelectors(el);
  for (const s of own) add(s);

  const parent = el.parentElement;
  if (parent) {
    const parentSels = localSelectors(parent);
    for (const o of own.slice(0, 6)) {
      for (const ps of parentSels.slice(0, 3)) add(`${ps} > ${o}`);
      add(`${parent.localName} > ${o}`);
    }
    const stableParent = parentSels.find((s) => isUnique(doc, s, parent));
    if (stableParent) add(`${stableParent} > ${nthOfType(el)}`);
  }

  add(path(el, nthOfType, true));
  add(path(el, nthOfType, false));
  add(path(el, nthChild, false));

  return found.slice(0, LIMITS.selectorCandidates);
}
