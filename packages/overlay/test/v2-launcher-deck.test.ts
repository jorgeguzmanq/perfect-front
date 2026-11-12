// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLauncher, type LauncherHandle } from '../src/launcher';

let ln: LauncherHandle | null = null;
const make = () =>
  (ln = createLauncher({ onToggleSelect() {}, onHide() {}, onShow() {}, onOpenComments() {} }));
const q = <T extends Element = HTMLElement>(s: string) => ln!.host.shadowRoot!.querySelector(s) as T | null;

afterEach(() => {
  ln?.destroy();
  ln = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('lanzador con el look del deck', () => {
  it('reposo: dock con tecla «hot» y conteo; eligiendo: tecla encendida', () => {
    make();
    const main = q<HTMLButtonElement>('.pf-ln-main')!;
    expect(q('.pf-ln-group')!.classList.contains('pf-dk-dock')).toBe(true);
    expect(main.classList.contains('pf-dk-key--hot')).toBe(true);
    expect(q('.pf-ln-badge')!.classList.contains('pf-dk-cnt')).toBe(true);
    ln!.setSelecting(true);
    expect(main.classList.contains('pf-dk-key--lit')).toBe(true);
    expect(main.classList.contains('pf-dk-key--hot')).toBe(false);
    ln!.setSelecting(false);
    expect(main.classList.contains('pf-dk-key--hot')).toBe(true);
  });

  it('menú: chasis del deck, resumen de pendientes y roles intactos', () => {
    make();
    ln!.setStats({ total: 3, here: 2, route: '/' });
    q<HTMLButtonElement>('.pf-ln-more')!.click();
    const menu = q('.pf-ln-menu')!;
    expect(menu.classList.contains('pf-dk-unit')).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(Array.from(menu.querySelectorAll('.pf-ln-stat .pf-dk-t1')).map((n) => n.textContent)).toEqual(['3', '2']);
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThanOrEqual(3);
  });

  it('aviso: LCD con LED verde; la acción opcional «Ver» se ejecuta y cierra el aviso', () => {
    make();
    const run = vi.fn();
    ln!.showHint('Comentario #5 guardado', { label: 'Ver', run });
    const toast = q('.pf-ln-toast')!;
    expect(toast.classList.contains('pf-dk-lcd')).toBe(true);
    expect(toast.querySelector('.pf-dk-led--green')).not.toBeNull();
    const act = q<HTMLButtonElement>('.pf-ln-toasta')!;
    expect(act.hidden).toBe(false);
    expect(act.textContent).toBe('Ver');
    act.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast.hidden).toBe(true);
    ln!.showHint('Otro aviso');
    expect(q<HTMLButtonElement>('.pf-ln-toasta')!.hidden).toBe(true);
  });
});
