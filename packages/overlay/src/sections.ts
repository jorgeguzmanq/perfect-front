import { LIMITS, type NewSection } from '@perfect-front/shared';
import { localId } from './dom';

/**
 * Secciones de un comentario: bloques extra (título + texto) además del texto principal. Cada imagen puede
 * atarse a una sección o quedar suelta; reubicarla es cambiar su `sectionId` (ver Attachments.moveTo).
 */
export interface EditableSection {
  id: string;
  title: string;
  text: string;
}

export class Sections {
  private list: EditableSection[] = [];

  get items(): readonly EditableSection[] {
    return this.list;
  }
  get full(): boolean {
    return this.list.length >= LIMITS.sections;
  }

  add(title = ''): EditableSection | null {
    if (this.full) return null;
    const s: EditableSection = { id: localId('s', new Set(this.list.map((x) => x.id))), title, text: '' };
    this.list.push(s);
    return s;
  }

  remove(id: string): void {
    this.list = this.list.filter((s) => s.id !== id);
  }

  update(id: string, patch: Partial<Pick<EditableSection, 'title' | 'text'>>): void {
    const s = this.list.find((x) => x.id === id);
    if (!s) return;
    if (patch.title !== undefined) s.title = patch.title.slice(0, LIMITS.sectionTitle);
    if (patch.text !== undefined) s.text = patch.text.slice(0, LIMITS.sectionText);
  }

  clear(): void {
    this.list = [];
  }

  /**
   * Secciones para la request. `keepIds` son las que tienen imágenes (una sección vacía sin imágenes se omite;
   * una vacía con imágenes se conserva para no perder la relación).
   */
  toRequest(keepIds: ReadonlySet<string>): NewSection[] {
    return this.list
      .filter((s) => s.text.trim() || s.title.trim() || keepIds.has(s.id))
      .map((s) => ({ id: s.id, title: s.title.trim() ? s.title.trim() : null, text: s.text }));
  }
}

/** `comment` (obligatorio, 1..10.000): el texto principal; si está vacío, se arma con las secciones. */
export function composeComment(main: string, sections: readonly EditableSection[]): string {
  const m = main.trim();
  if (m) return m.slice(0, LIMITS.comment);
  const parts = sections
    .map((s) => [s.title.trim(), s.text.trim()].filter(Boolean).join(': '))
    .filter(Boolean);
  return parts.join('\n\n').slice(0, LIMITS.comment);
}
