import { LIMITS, type ExtraTarget } from '@perfect-front/shared';
import { serializeElement, snapshotElement, type ElementSnapshot } from './context';
import { localId, parseSrc } from './dom';

/** Total de elementos de una multiselección: el principal + `extraTargets`. */
export const MAX_NODES = 1 + LIMITS.extraTargets;

export interface SelectedNode {
  el: Element;
  snap: ElementSnapshot;
}

/**
 * Multiselección: un solo comentario con N nodos. El «foco» es el nodo sobre el que actúan la navegación,
 * Contenido, Estructura y (por defecto) Estilos; el resto viaja como `extraTargets`.
 */
export class Selection {
  private list: SelectedNode[] = [];
  private focusIdx = 0;

  get nodes(): readonly SelectedNode[] {
    return this.list;
  }
  get size(): number {
    return this.list.length;
  }
  get multi(): boolean {
    return this.list.length > 1;
  }
  get focusIndex(): number {
    return this.focusIdx;
  }
  get focus(): SelectedNode | null {
    return this.list[this.focusIdx] ?? null;
  }

  /** Reemplaza toda la selección por un nodo. */
  set(el: Element): SelectedNode {
    const n = { el, snap: snapshotElement(el) };
    this.list = [n];
    this.focusIdx = 0;
    return n;
  }

  clear(): void {
    this.list = [];
    this.focusIdx = 0;
  }

  has(el: Element): boolean {
    return this.list.some((n) => n.el === el);
  }

  /** Suma un nodo (y lo enfoca). false si ya estaba o se llegó al máximo. */
  add(el: Element): boolean {
    if (this.has(el) || this.list.length >= MAX_NODES) return false;
    this.list.push({ el, snap: snapshotElement(el) });
    this.focusIdx = this.list.length - 1;
    return true;
  }

  /** Shift+clic: quita si estaba, suma si no. Nunca deja la selección vacía. */
  toggle(el: Element): 'added' | 'removed' | 'full' | 'kept' {
    const i = this.list.findIndex((n) => n.el === el);
    if (i >= 0) return this.remove(i) ? 'removed' : 'kept';
    return this.add(el) ? 'added' : 'full';
  }

  remove(i: number): boolean {
    if (this.list.length <= 1 || i < 0 || i >= this.list.length) return false;
    this.list.splice(i, 1);
    if (this.focusIdx >= this.list.length) this.focusIdx = this.list.length - 1;
    else if (i < this.focusIdx) this.focusIdx--;
    return true;
  }

  setFocus(i: number): void {
    if (i >= 0 && i < this.list.length) this.focusIdx = i;
  }

  /** Mueve el foco a otro elemento (navegación ↑↓←→): reemplaza el nodo enfocado, no suma. */
  retarget(el: Element): SelectedNode {
    const n = { el, snap: snapshotElement(el) };
    if (this.list.length === 0) this.list.push(n);
    else this.list[this.focusIdx] = n;
    return n;
  }

  /** Refresca los snapshots (p. ej. tras un reordenamiento o scroll). */
  refresh(): void {
    this.list = this.list.map((n) => ({ el: n.el, snap: snapshotElement(n.el) }));
  }

  /** El nodo principal es el primero; el resto son `extraTargets` del payload. */
  toExtraTargets(taken?: ReadonlySet<string>): ExtraTarget[] {
    const used = new Set(taken ?? []);
    return this.list.slice(1).map((n) => {
      const id = localId('t', used);
      used.add(id);
      const source = parseSrc(n.snap.src);
      return {
        id,
        selector: n.snap.selector,
        selectorCandidates: n.snap.selectorCandidates,
        text: n.snap.text,
        html: serializeElement(n.el, LIMITS.extraTargetHtml),
        componentHint: n.snap.componentHint,
        ...(source ? { source } : {}),
        elementRect: n.snap.rect,
      };
    });
  }
}
