import { formatLocationRef, type LocationRefFormat, type LocationRefInput } from '@perfect-front/shared';
import { describe, parseSrc } from './dom';
import type { SelectedNode } from './selection';

/** «Copiar ubicación»: formatos por nodo (archivo, selector, pf://, markdown) y «todos» para multiselección. */

export type CopyKey = 'file' | 'sel' | 'pf' | 'md' | 'all';

const FORMAT_OF: Record<Exclude<CopyKey, 'all'>, LocationRefFormat> = {
  file: 'file',
  sel: 'selector',
  pf: 'pf',
  md: 'markdown',
};

export const COPY_LABELS: Record<CopyKey, string> = {
  file: 'Archivo y línea',
  sel: 'Selector CSS',
  pf: 'Referencia Perfect Front',
  md: 'Markdown para pegar',
  all: 'Los elementos',
};

export function refInput(doc: Document, n: SelectedNode): LocationRefInput {
  return {
    route: doc.location.pathname || '/',
    selector: n.snap.selector,
    source: parseSrc(n.snap.src),
    label: describe(n.el),
  };
}

/** Texto de un nodo en un formato; null si no hay dato (p. ej. sin `data-pf-src` para «archivo»). */
export function copyText(doc: Document, n: SelectedNode, key: Exclude<CopyKey, 'all'>): string | null {
  return formatLocationRef(FORMAT_OF[key], refInput(doc, n));
}

/** Lista `- ` por nodo con el mejor dato disponible (archivo:línea, si no el selector). */
export function copyAll(doc: Document, nodes: readonly SelectedNode[]): string {
  return nodes
    .map((n) => `- ${copyText(doc, n, 'file') ?? copyText(doc, n, 'sel') ?? describe(n.el)}`)
    .join('\n');
}

/** Valor a mostrar en el menú (con «sin dato» si falta). */
export function previewFor(doc: Document, nodes: readonly SelectedNode[], focus: number, key: CopyKey): string | null {
  if (key === 'all') return nodes.length > 1 ? copyAll(doc, nodes).replace(/\n/g, ' ⏎ ') : null;
  const n = nodes[focus];
  return n ? copyText(doc, n, key) : null;
}

/** Clic simple: «archivo:línea» si existe, si no el selector. */
export function quickCopyText(doc: Document, n: SelectedNode): string | null {
  return copyText(doc, n, 'file') ?? copyText(doc, n, 'sel');
}

/** Escribe en el portapapeles (API async; respaldo con execCommand). Nunca lanza. */
export async function writeClipboard(doc: Document, text: string): Promise<boolean> {
  const nav = doc.defaultView?.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* sin permiso: se prueba el respaldo */
  }
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Una sola referencia completa para pegar a una persona o a un agente: todo lo que ubica el elemento, sin líneas vacías. */
export function fullReference(doc: Document, nodes: readonly SelectedNode[]): string | null {
  if (!nodes.length) return null;
  const loc = doc.location;
  const route = loc.pathname || '/';
  const blocks = nodes.map((n, i) => {
    const s = n.snap;
    const input = refInput(doc, n);
    const file = formatLocationRef('file', input);
    const alt = s.selectorCandidates.filter((c) => c !== s.selector).slice(0, 3);
    const text = s.text?.replace(/\s+/g, ' ').trim();
    const rows: Array<[string, string | null]> = [
      ['Componente', s.components?.length ? s.components.join(' < ') : null],
      ['Archivo', file],
      ['Selector', s.selector],
      ['Alternativos', alt.length ? alt.join('  |  ') : null],
      ['Texto', text ? `"${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"` : null],
      ['Tamaño', `${Math.round(s.rect.width)}×${Math.round(s.rect.height)} px en (${Math.round(s.rect.x)}, ${Math.round(s.rect.y)}) · viewport ${s.viewport.width}×${s.viewport.height}`],
      ['Ref', formatLocationRef('pf', input)],
    ];
    const lines = rows.filter((r): r is [string, string] => !!r[1]).map(([k, v]) => `${k}: ${v}`);
    return (nodes.length > 1 ? [`# Elemento ${i + 1} de ${nodes.length}`, ...lines] : lines).join('\n');
  });
  return [`Perfect Front · referencia\nRuta: ${route} (${loc.href})`, ...blocks].join('\n\n');
}
