import { COMMENT_VERSION, LIMITS, type CreateCommentRequest } from '@perfect-front/shared';
import { reactComponents, sourceAnnotation } from './react';
import { generateSelectorCandidates } from './selector';

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template']);
const MAX_ATTR = 200;
const MAX_DEPTH = 12;
const TRUNCATED = '<!-- … -->';

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** Texto visible limitado; ignora script/style y se detiene al alcanzar el límite. */
export function extractText(el: Element, max: number = LIMITS.text): string | null {
  const parts: string[] = [];
  let len = 0;
  const walk = (node: Node) => {
    if (len > max) return;
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(/\s+/g, ' ');
      parts.push(t);
      len += t.length;
    } else if (node.nodeType === 1 && !SKIP_TEXT.has((node as Element).localName)) {
      for (const c of Array.from(node.childNodes)) walk(c);
    }
  };
  walk(el);
  const text = parts.join('').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || null;
}

/**
 * Serializa el elemento como TEXTO (nunca innerHTML/outerHTML): descarta handlers `on*`,
 * `srcdoc`, valores de formularios y URLs `javascript:`, escapa todo y limita el tamaño.
 * El resultado es un string inerte; nada de la página se ejecuta ni se inserta en el DOM.
 */
export function serializeElement(el: Element, max: number = LIMITS.html): string {
  let out = '';
  let truncated = false;
  const emit = (s: string): boolean => {
    if (out.length + s.length > max - TRUNCATED.length) {
      truncated = true;
      return false;
    }
    out += s;
    return true;
  };
  const walk = (node: Element, depth: number): void => {
    if (truncated) return;
    const tag = node.localName;
    let open = `<${tag}`;
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'value' || name === 'style') continue;
      let v = attr.value;
      if (/^\s*(javascript|data):/i.test(v) && (name === 'href' || name === 'src' || name === 'action')) v = '';
      if (v.length > MAX_ATTR) v = v.slice(0, MAX_ATTR) + '…';
      open += ` ${escText(attr.name)}="${escAttr(v)}"`;
    }
    if (SKIP_TEXT.has(tag)) {
      emit(`${open}></${tag}>`);
      return;
    }
    if (!emit(open + '>')) return;
    if (depth >= MAX_DEPTH) {
      if (node.childNodes.length) emit(TRUNCATED);
    } else {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          if (!emit(escText(child.nodeValue ?? ''))) return;
        } else if (child.nodeType === 1) walk(child as Element, depth + 1);
        if (truncated) return;
      }
    }
    emit(`</${tag}>`);
  };
  walk(el, 0);
  if (truncated) out += TRUNCATED;
  return out;
}

function viewportOf(doc: Document) {
  const win = doc.defaultView;
  return {
    width: win?.innerWidth || 1,
    height: win?.innerHeight || 1,
    devicePixelRatio: win?.devicePixelRatio || 1,
    scrollX: win?.scrollX ?? 0,
    scrollY: win?.scrollY ?? 0,
  };
}

function colorScheme(doc: Document): 'light' | 'dark' | null {
  const mm = doc.defaultView?.matchMedia;
  if (typeof mm !== 'function') return null;
  try {
    return mm.call(doc.defaultView, '(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return null;
  }
}

export interface ElementSnapshot {
  selector: string;
  selectorCandidates: string[];
  text: string | null;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Componentes React (más específico primero) o null. */
  components: string[] | null;
  /** `archivo:línea` si el DOM trae `data-pf-src`. */
  src: string | null;
  componentHint: string | null;
  viewport: ReturnType<typeof viewportOf>;
}

/** Captura el contexto del elemento en el momento de la selección. */
export function snapshotElement(el: Element): ElementSnapshot {
  const doc = el.ownerDocument;
  const candidates = generateSelectorCandidates(el);
  const r = el.getBoundingClientRect();
  const components = reactComponents(el);
  const src = sourceAnnotation(el);
  const hint = [components?.join(' < '), src ? `(${src})` : null].filter(Boolean).join(' ');
  return {
    selector: candidates[0] ?? el.localName,
    selectorCandidates: candidates,
    text: extractText(el),
    html: serializeElement(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    components,
    src,
    componentHint: hint ? hint.slice(0, 200) : null,
    viewport: viewportOf(doc),
  };
}

function locationBase(doc: Document) {
  const loc = doc.location;
  return {
    url: loc.href.slice(0, 2048),
    route: ((loc.pathname || '/') + (loc.search || '')).slice(0, 2048),
    title: doc.title ? doc.title.slice(0, 500) : null,
  };
}

/** Construye la request (sin validar; el llamador usa CreateCommentRequestSchema). */
export function buildRequest(
  doc: Document,
  comment: string,
  snap: ElementSnapshot | null,
): unknown {
  const base = locationBase(doc);
  const req: Record<string, unknown> = {
    version: COMMENT_VERSION,
    scope: snap ? 'element' : 'view',
    comment,
    location: {
      ...base,
      selector: snap ? snap.selector : null,
      selectorCandidates: snap ? snap.selectorCandidates : [],
      text: snap ? snap.text : null,
      html: snap ? snap.html : null,
      componentHint: snap ? snap.componentHint : null,
    },
    viewport: snap ? snap.viewport : viewportOf(doc),
    elementRect: snap ? snap.rect : null,
    environment: { colorScheme: colorScheme(doc) },
  };
  return req satisfies Partial<CreateCommentRequest> | Record<string, unknown>;
}
