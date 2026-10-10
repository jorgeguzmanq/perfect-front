import type { CommentProposal } from '@perfect-front/shared';
import { localId } from './dom';
import { siblingsOf } from './dom-nav';

type ReorderProposal = Extract<CommentProposal, { kind: 'reorder' }>;

/**
 * Reordenar hermanos como PROPUESTA «mover de N a M» (posiciones 1-based). Nunca muta el DOM de la página:
 * la vista previa es solo un indicador (línea de inserción) sobre el hermano de destino, así no se rompe
 * el árbol que maneja el framework. `order` es el orden virtual de los hermanos.
 */
export class ReorderModel {
  readonly parent: Element | null;
  private readonly original: Element[];
  private order: Element[];
  readonly moved: Element;

  constructor(el: Element) {
    this.parent = el.parentElement;
    this.original = siblingsOf(el);
    this.order = [...this.original];
    this.moved = el;
  }

  get siblingCount(): number {
    return this.original.length;
  }
  /** Posición 1-based original. */
  get from(): number {
    return this.original.indexOf(this.moved) + 1;
  }
  /** Posición 1-based actual (tras mover). */
  get to(): number {
    return this.order.indexOf(this.moved) + 1;
  }
  get changed(): boolean {
    return this.from !== this.to;
  }
  get virtualOrder(): readonly Element[] {
    return this.order;
  }
  get canUp(): boolean {
    return this.to > 1;
  }
  get canDown(): boolean {
    return this.to < this.order.length;
  }

  /** Mueve a una posición 1-based (acotada). */
  moveTo(pos: number): boolean {
    const target = Math.max(1, Math.min(this.order.length, Math.round(pos)));
    const cur = this.to;
    if (target === cur) return false;
    this.order.splice(cur - 1, 1);
    this.order.splice(target - 1, 0, this.moved);
    return true;
  }
  moveUp(): boolean {
    return this.moveTo(this.to - 1);
  }
  moveDown(): boolean {
    return this.moveTo(this.to + 1);
  }
  /** Arrastre: suelta sobre el hermano `over` (toma su posición). */
  dropOn(over: Element): boolean {
    const i = this.order.indexOf(over);
    return i >= 0 && this.moveTo(i + 1);
  }
  undo(): void {
    this.order = [...this.original];
  }

  /**
   * Hermano original sobre el que dibujar la línea de inserción en la página: el que hoy ocupa la posición
   * de destino (antes de él si se sube, después si se baja).
   */
  indicator(): { el: Element; side: 'before' | 'after' } | null {
    if (!this.changed) return null;
    const target = this.original[this.to - 1];
    return target ? { el: target, side: this.to < this.from ? 'before' : 'after' } : null;
  }

  toProposal(selector: string, parentSelector: string | null, taken?: ReadonlySet<string>): ReorderProposal | null {
    if (!this.changed) return null;
    return {
      id: localId('p', taken),
      kind: 'reorder',
      targetSelector: selector,
      parentSelector,
      from: this.from,
      to: this.to,
      siblingCount: this.siblingCount,
    };
  }
}
