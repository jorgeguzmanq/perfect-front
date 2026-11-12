import { formatBytes } from './attachments';
import {
  formatPx,
  formatSize,
  scaleOptions,
  scaleOptionsForEach,
  unionBox,
  type CaptureScale,
  type ScaleOption,
} from './capture-scale';
import { copyImage } from './clipboard';
import { boxOf, nodeLabel, renderBox, revealNode, type RenderedShot } from './capture-node';
import { chip, DK, kb, key, lab, led, pbar, rack, tagk, tray, unit, warn } from './deck';
import { describe, h } from './dom';
import { icon } from './icons';
import type { CapturedShot, ShotCard } from './types';

type Mode = 'separate' | 'join';
type Phase = 'options' | 'run' | 'done';
const MAX_MB = 5;
const MARGINS = [0, 8, 16, 24] as const;

export interface CaptureControllerOptions {
  doc: Document;
  /** Capa del overlay (Shadow Root propio: isPfNode la excluye de la captura). */
  layer: HTMLElement;
  /** Suma las capturas al comentario en construcción («Adjuntar N»). */
  attach(shots: readonly CapturedShot[]): { added: number; error?: string };
  announce(msg: string): void;
  /** Cada vez que se muestra una tarjeta de resultado nueva (enganche para Copiar/Descargar). */
  onShotCard?(card: ShotCard): void;
}

export interface CaptureController {
  readonly active: boolean;
  /** Abre la captura de `nodes`. false si no hay nodos conectados. */
  open(nodes: readonly Element[]): boolean;
  /**
   * Captura rápida 1×: un solo render por nodo, sin panel ni pasos intermedios; adjunta y copia al portapapeles.
   * Devuelve las capturas adjuntas (vacío si falló).
   */
  quick(nodes: readonly Element[]): Promise<RenderedShot[]>;
  close(): void;
  destroy(): void;
}

/** Capa de captura: marco(s) sobre el nodo, barra de escalas y tarjeta de resultado. Vive en el Shadow DOM del overlay. */
export function createCaptureController(opts: CaptureControllerOptions): CaptureController {
  const { doc, layer } = opts;
  const win = doc.defaultView ?? window;

  let nodes: Element[] = [];
  let mode: Mode = 'separate';
  const picked = new Set<CaptureScale>([1]);
  let phase: Phase = 'options';
  let format: 'png' | 'webp' = 'png';
  let background: 'transparent' | 'page' = 'transparent';
  let margin = 0;
  let showCmp = false;
  let fresh = true;
  let runScales: CaptureScale[] = [];
  let runGroups = 1;
  const doneBy = new Map<CaptureScale, number>();
  let toast: HTMLElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let results: RenderedShot[] = [];
  let errors: string[] = [];
  let progress = '';
  let attachError = '';
  let runId = 0;
  let destroyed = false;

  let wrap: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let frames: HTMLElement[] = [];
  let offs: Array<() => void> = [];

  const frameBoxes = () => nodes.filter((n) => n.isConnected).map(boxOf);

  const options = (): ScaleOption[] => {
    const boxes = frameBoxes().map((b) => ({ ...b, width: b.width + 2 * margin, height: b.height + 2 * margin }));
    let base: ScaleOption[];
    if (mode === 'join' || boxes.length <= 1) {
      const u = unionBox(boxes);
      base = scaleOptions(u?.width ?? 1, u?.height ?? 1);
    } else base = scaleOptionsForEach(boxes);
    return base.map((o) => (o.enabled && (o.width * o.height) / 1000 * 0.55 / 1024 > MAX_MB ? { ...o, enabled: false, reason: 'Pesaría más de 5 MB' } : o));
  };

  const placeFrames = () => {
    nodes.forEach((n, i) => {
      const f = frames[i];
      if (!f) return;
      if (!n.isConnected) return void (f.hidden = true);
      const b = boxOf(n);
      f.style.top = `${b.top}px`;
      f.style.left = `${b.left}px`;
      f.style.width = `${b.width}px`;
      f.style.height = `${b.height}px`;
    });
  };

  const setFramesHidden = (hide: boolean) => {
    for (const f of frames) f.hidden = hide;
    if (!hide) placeFrames();
  };

  const clearFrames = () => {
    for (const f of frames) f.remove();
    frames = [];
  };

  const tx = (n: number) => `${n}×`;

  const heading = (title: string, sub: string) => {
    const head = h(doc, 'div', `${DK.lcd} ${DK.lp} ${DK.fx} pf-dk-g12 pf-cap-head`);
    const tag = tagk(doc, '');
    tag.appendChild(icon(doc, 'cam', 16));
    const id = h(doc, 'div', `${DK.grow} pf-cap-id`);
    id.append(h(doc, 'div', 'pf-dk-t2', title), h(doc, 'div', 'pf-dk-ts pf-dk-ell', sub));
    const hint = h(doc, 'span', 'pf-cap-kbs');
    hint.setAttribute('aria-label', 'Atajo Alt Mayús S');
    hint.append(kb(doc, 'Alt'), kb(doc, '⇧'), kb(doc, 'S'));
    const x = key(doc, '', { sq: true, sm: true, variant: 'ghost', icon: 'close', iconSize: 14, ariaLabel: 'Cerrar captura', onClick: () => api.close() });
    head.append(tag, id, hint, x);
    return head;
  };

  const nodesSummary = () => {
    if (nodes.length > 1) return `${nodes.length} nodos`;
    const el = nodes[0];
    const b = el ? boxOf(el) : null;
    return el && b ? `${describe(el)} · ${formatSize(b)} px` : '';
  };

  /** Etiqueta + bandeja de opciones excluyentes (aria-pressed; la activa se enciende). */
  const choice = <T extends string | number>(label: string, cur: T, items: ReadonlyArray<readonly [T, string]>, set: (v: T) => void, k: string) => {
    const col = h(doc, 'div', 'pf-cap-opt');
    const t = tray(
      doc,
      items.map(([v, text]) => {
        const b = key(doc, text, { pressed: cur === v, cls: 'pf-cap-optkey', onClick: () => set(v) });
        b.dataset.k = `${k}-${v}`;
        return b;
      }),
      { role: 'group', label },
    );
    col.append(lab(doc, label), t);
    return col;
  };

  const footer = (summary: string, ...keys: HTMLElement[]) => {
    const f = h(doc, 'div', `${DK.fx} pf-dk-g12 pf-cap-foot`);
    f.append(h(doc, 'span', `pf-dk-ts ${DK.grow}`, summary), ...keys);
    return f;
  };

  const comparison = (big: ScaleOption) => {
    const b0 = nodes[0] ? boxOf(nodes[0]) : { width: 1, height: 1, left: 0, top: 0 };
    const w = Math.ceil(b0.width) + 2 * margin;
    const hh = Math.ceil(b0.height) + 2 * margin;
    const wrap = h(doc, 'div', `${DK.fx} pf-dk-g8 pf-dk-wr pf-cap-cmp`);
    const cards: ReadonlyArray<readonly [string, boolean, string]> = [
      ['Estirada desde 1×', false, `${formatPx(w)}×${formatPx(hh)} → ${formatSize(big)} · bordes y texto borrosos`],
      [`Renderizada a ${tx(big.scale)}`, true, `${formatSize(big)} reales · nítida`],
    ];
    for (const [title, ok, note] of cards) {
      const card = h(doc, 'div', `${DK.lcd} ${DK.lp} pf-cap-cmpcard`);
      card.append(chip(doc, title, { on: ok, led: ok ? 'green' : 'amber' }));
      card.append(h(doc, 'span', `pf-cap-sample${ok ? '' : ' pf-cap-sample--blur'}`, nodes[0] ? nodeLabel(nodes[0]) : 'nodo'));
      card.append(h(doc, 'p', 'pf-dk-ts', note));
      wrap.appendChild(card);
    }
    return wrap;
  };

  // --- Vistas --------------------------------------------------------------------------------------

  const renderOptions = (box: HTMLElement) => {
    box.appendChild(heading('Capturar nodo', nodesSummary()));
    const body = h(doc, 'div', 'pf-cap-body');
    box.appendChild(body);

    if (nodes.length > 1) {
      const grp = tray(
        doc,
        (
          [
            ['separate', 'Cada uno por separado'],
            ['join', 'Todos juntos'],
          ] as const
        ).map(([m, label]) => {
          const b = key(doc, label, { pressed: mode === m, onClick: () => ((mode = m), paint()) });
          b.setAttribute('role', 'radio');
          b.removeAttribute('aria-pressed');
          b.setAttribute('aria-checked', String(mode === m));
          b.classList.toggle('pf-dk-key--lit', mode === m);
          b.dataset.k = `mode-${m}`;
          return b;
        }),
        { role: 'radiogroup', label: 'Varios nodos' },
      );
      body.append(lab(doc, `${nodes.length} nodos seleccionados`), grp);
    }

    const opts_ = options();
    body.appendChild(lab(doc, 'Escala · render real'));
    const list = tray(doc, [], { role: 'group', label: 'Escalas' });
    for (const o of opts_) {
      const on = o.enabled && picked.has(o.scale);
      const b = key(doc, '', {
        tall: true,
        pressed: on,
        disabled: !o.enabled,
        ariaLabel: `${tx(o.scale)} ${formatSize(o)} px`,
        title: o.enabled ? `${formatSize(o)} px` : (o.reason ?? 'no disponible'),
        cls: 'pf-cap-scalekey',
        onClick: () => {
          if (picked.has(o.scale)) picked.delete(o.scale);
          else picked.add(o.scale);
          paint();
        },
      });
      b.dataset.k = `scale-${o.scale}`;
      b.append(h(doc, 'b', 'pf-cap-sx', tx(o.scale)), h(doc, 'span', 'pf-dk-ts', formatSize(o)));
      list.appendChild(b);
    }
    body.appendChild(list);

    const off = opts_.filter((o) => !o.enabled);
    if (off.length) {
      body.appendChild(warn(doc, `${off.map((o) => tx(o.scale)).join(', ')} apagada${off.length > 1 ? 's' : ''}: ${off[0]!.reason ?? 'no disponible'}. Elige una escala menor.`));
    } else {
      const note = h(doc, 'p', 'pf-dk-ts');
      note.append('Cada escala se ', h(doc, 'b', undefined, 'vuelve a renderizar'), ': no se agranda una imagen de 1×.');
      body.appendChild(note);
    }

    const row1 = h(doc, 'div', `${DK.fx} pf-dk-g16 pf-dk-wr`);
    row1.append(
      choice('Fondo', background, [['transparent', 'Transparente'], ['page', 'De la página']] as const, (v) => ((background = v), paint()), 'bg'),
      choice('Formato', format, [['png', 'PNG'], ['webp', 'WebP']] as const, (v) => ((format = v), paint()), 'fmt'),
      choice('Margen', margin, MARGINS.map((m) => [m, String(m)] as const), (v) => ((margin = v), paint()), 'pad'),
    );
    body.appendChild(row1);

    // Comparación real vs. estirado (con la mayor escala disponible).
    const big = [...opts_].reverse().find((o) => o.enabled && o.scale > 1);
    if (big) {
      const cmpKey = key(doc, 'Comparar real y estirado', { sm: true, variant: 'ghost', pressed: showCmp, onClick: () => ((showCmp = !showCmp), paint()) });
      cmpKey.dataset.k = 'cmp';
      body.appendChild(cmpKey);
      if (showCmp) body.appendChild(comparison(big));
    }

    const n = opts_.filter((o) => o.enabled && picked.has(o.scale)).length;
    const total = n * (mode === 'separate' ? nodes.length : 1);
    if (errors.length) body.appendChild(warn(doc, errors.join(' · '), { bad: true }));
    const go = key(doc, total > 1 ? `Capturar ${total} imágenes` : 'Capturar', { variant: 'hot', icon: 'cam', disabled: total === 0, onClick: () => void run() });
    box.appendChild(footer(`${total} archivo${total === 1 ? '' : 's'}`, key(doc, 'Cancelar', { variant: 'ghost', onClick: () => api.close() }), go));
    if (fresh) queueMicrotask(() => go.isConnected && !go.disabled && go.focus());
  };

  const renderRun = (box: HTMLElement) => {
    box.appendChild(heading('Renderizando…', 'A cada escala se re-dibuja la página; no se estira una imagen'));
    const body = h(doc, 'div', 'pf-cap-body');
    const st = h(doc, 'div', `${DK.fx} pf-dk-g12`);
    st.setAttribute('role', 'status');
    st.append(led(doc, true, 'violet'), h(doc, 'span', 'pf-dk-tx', `Renderizando a ${progress} · el overlay se oculta`));
    body.appendChild(st);
    for (const sc of runScales) {
      const pct = Math.min(100, Math.round(((doneBy.get(sc) ?? 0) / Math.max(1, runGroups)) * 100));
      const r = h(doc, 'div', `${DK.fx} pf-dk-g12`);
      const bar = pbar(doc, pct, pct >= 100);
      bar.classList.add(DK.grow);
      r.append(h(doc, 'b', 'pf-dk-t2 pf-cap-rs', tx(sc)), bar, h(doc, 'span', 'pf-dk-ts pf-cap-rp', pct >= 100 ? '✓' : `${pct}%`));
      body.appendChild(r);
    }
    box.appendChild(body);
    box.appendChild(footer('', key(doc, 'Capturando…', { variant: 'hot', disabled: true })));
  };

  const cardHandle = (root: HTMLElement, actions: HTMLElement): ShotCard => ({
    root,
    actions,
    get shots() {
      return results;
    },
  });

  const renderDone = (box: HTMLElement) => {
    const ok = results.length;
    box.appendChild(heading(ok ? 'Captura lista' : 'No se pudo capturar', ok ? 'Revisa antes de adjuntar' : 'Prueba con otra escala'));
    const body = h(doc, 'div', 'pf-cap-body');
    box.appendChild(body);
    if (ok) body.appendChild(lab(doc, `Resultado · ${ok} archivo${ok === 1 ? '' : 's'}`));
    const list = h(doc, 'ul', 'pf-cap-shots');
    for (const s of results) {
      const li = h(doc, 'li', 'pf-cap-shot');
      const r = rack(doc);
      const img = h(doc, 'img', 'pf-cap-thumb');
      img.src = `data:${s.mimeType};base64,${s.dataBase64}`;
      img.alt = '';
      const meta = h(doc, 'span', `${DK.grow} pf-cap-meta`);
      meta.append(h(doc, 'b', 'pf-dk-tg', s.name), h(doc, 'small', 'pf-dk-ts', `${formatSize(s)} px · ${formatBytes(s.bytes)} · render real a ${tx(s.scale)}`));
      const rm = key(doc, '', {
        sq: true,
        sm: true,
        variant: 'ghost',
        icon: 'close',
        iconSize: 14,
        ariaLabel: `Quitar ${s.name}`,
        onClick: () => {
          results = results.filter((x) => x !== s);
          paint(true);
        },
      });
      r.append(img, meta, rm);
      li.appendChild(r);
      list.appendChild(li);
    }
    body.appendChild(list);
    const msgs = [...errors, ...(attachError ? [attachError] : [])];
    if (msgs.length) body.appendChild(warn(doc, msgs.join(' · '), { bad: true }));
    // Enganche: aquí se añaden Copiar / Descargar.
    const actions = h(doc, 'div', 'pf-ov-shot-actions');
    body.appendChild(actions);
    const attach = key(doc, ok ? `Adjuntar ${ok}` : 'Adjuntar', { variant: 'hot', icon: 'img', disabled: ok === 0, onClick: () => doAttach() });
    box.appendChild(
      footer(
        `${ok} archivo${ok === 1 ? '' : 's'}`,
        key(doc, 'Capturar de nuevo', { icon: 'cam', onClick: () => retake() }),
        key(doc, 'Cerrar', { variant: 'ghost', onClick: () => api.close() }),
        attach,
      ),
    );
    queueMicrotask(() => attach.isConnected && !attach.disabled && attach.focus());
    try {
      opts.onShotCard?.(cardHandle(box, actions));
    } catch {
      /* un enganche externo no debe romper la tarjeta */
    }
  };

  function paint(isFresh = false) {
    if (!panel) return;
    const active = (panel.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const keep = !isFresh && active && panel.contains(active) ? (active.dataset.k ?? '') : '';
    fresh = isFresh || !keep;
    panel.textContent = '';
    panel.setAttribute('data-phase', phase);
    if (phase === 'options') renderOptions(panel);
    else if (phase === 'run') renderRun(panel);
    else renderDone(panel);
    if (keep) panel.querySelector<HTMLElement>(`[data-k="${keep}"]`)?.focus();
  }

  // --- Acciones ------------------------------------------------------------------------------------

  async function run() {
    const live = nodes.filter((n) => n.isConnected);
    if (!live.length || phase === 'run') return;
    const scales = options()
      .filter((o) => o.enabled && picked.has(o.scale))
      .map((o) => o.scale);
    if (!scales.length) return;
    const my = ++runId;
    phase = 'run';
    hideToast();
    results = [];
    errors = [];
    attachError = '';
    // La capa (marcos) solo se ve hasta aquí. La página real no se toca: los nodos propios se excluyen con el filtro.
    setFramesHidden(true);
    const groups = mode === 'join' ? [live] : live.map((n) => [n]);
    const jobs = groups.length * scales.length;
    runScales = scales;
    runGroups = groups.length;
    doneBy.clear();
    let done = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const base = group.length > 1 ? 'nodos' : nodeLabel(group[0]!);
      const label = mode === 'separate' && live.length > 1 ? `${gi + 1}-${base}` : base;
      for (const scale of scales) {
        progress = `${scale}× (${done + 1} de ${jobs}) · ${label}`;
        paint();
        try {
          await revealNode(group[0]!, win);
          const u = unionBox(group.map(boxOf));
          if (!u) throw new Error('el nodo ya no está en la página');
          const shot = await renderBox(u, scale, label, win, { format, background, margin });
          if (my !== runId || destroyed) return;
          results.push(shot);
        } catch (e) {
          if (my !== runId || destroyed) return;
          errors.push(`${label} ${scale}×: ${e instanceof Error ? e.message : 'falló el renderizado'}`);
        }
        done++;
        doneBy.set(scale, (doneBy.get(scale) ?? 0) + 1);
      }
    }
    if (my !== runId || destroyed) return;
    phase = 'done';
    paint(true);
    opts.announce(results.length ? `${results.length} capturas listas.` : 'No se pudo capturar.');
  }

  function retake() {
    runId++;
    phase = 'options';
    results = [];
    errors = [];
    attachError = '';
    setFramesHidden(false);
    paint(true);
  }

  function doAttach() {
    if (!results.length) return;
    const r = opts.attach(results);
    if (r.error || r.added < results.length) {
      attachError = r.error ?? 'No se pudieron adjuntar todas.';
      paint();
      return;
    }
    opts.announce(`${r.added} ${r.added > 1 ? 'imágenes adjuntas' : 'imagen adjunta'} al comentario.`);
    api.close();
  }

  // --- Ciclo de vida -------------------------------------------------------------------------------

  let quickBusy = false;

  function hideToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = undefined;
    toast?.remove();
    toast = null;
  }

  /** Aviso de la captura rápida: LED verde, atajo y salidas a «Más opciones…» / adjunto. */
  function showToast(shot: RenderedShot, copied: boolean, message: string, from: readonly Element[]) {
    hideToast();
    if (destroyed) return;
    const u = unit(doc, { model: 'PF·SHOT', name: '07', cls: 'pf-cap-toast' });
    u.setAttribute('role', 'status');
    const l = h(doc, 'div', `${DK.lcd} ${DK.lp} ${DK.fx} pf-dk-g12`);
    const id = h(doc, 'div', DK.grow);
    id.append(
      h(doc, 'div', 'pf-dk-t2', copied ? 'Captura 1× copiada' : 'Captura 1× adjunta'),
      h(doc, 'div', 'pf-dk-ts pf-dk-ell', `${shot.label} · ${formatSize(shot)} px · ${copied ? 'en el portapapeles' : message}`),
    );
    const hint = h(doc, 'span', 'pf-cap-kbs');
    hint.append(kb(doc, 'Alt'), kb(doc, '⇧'), kb(doc, 'S'));
    l.append(led(doc, true, copied ? 'green' : 'amber'), id, hint);
    const note = h(doc, 'p', 'pf-dk-ts pf-cap-toast-note', 'Atajo rápido: un solo render a 1×, sin abrir las opciones. Pega con Ctrl+V donde quieras.');
    const row = h(doc, 'div', `${DK.fx} pf-dk-g12 pf-dk-wr`);
    row.append(
      key(doc, 'Más opciones…', { icon: 'cam', onClick: () => void api.open(from) }),
      key(doc, 'Adjunta al comentario', { variant: 'hot', icon: 'img', pressed: true, disabled: true }),
    );
    u.append(l, note, row);
    layer.appendChild(u);
    toast = u;
    toastTimer = win.setTimeout(hideToast, 7000) as unknown as ReturnType<typeof setTimeout>;
  }

  async function quick(list: readonly Element[]): Promise<RenderedShot[]> {
    const live = list.filter((n) => n.isConnected);
    if (destroyed || quickBusy || !live.length) return [];
    quickBusy = true;
    const shots: RenderedShot[] = [];
    try {
      opts.announce('Capturando…');
      for (const n of live) {
        try {
          await revealNode(n, win);
          shots.push(await renderBox(boxOf(n), 1, nodeLabel(n), win, { fast: true }));
        } catch (e) {
          opts.announce(`No se pudo capturar: ${e instanceof Error ? e.message : 'falló el renderizado'}`);
          if (!shots.length) return [];
        }
        if (destroyed) return [];
      }
      const r = opts.attach(shots);
      if (r.error || r.added === 0) {
        opts.announce(r.error ?? 'No se pudo adjuntar la captura.');
        return [];
      }
      // El portapapeles admite una imagen: la primera. Si falla, queda el botón Copiar del adjunto.
      const c = await copyImage(`data:${shots[0]!.mimeType};base64,${shots[0]!.dataBase64}`);
      opts.announce(c.ok ? 'Captura adjunta y copiada.' : `Captura adjunta. ${c.message}`);
      showToast(shots[0]!, c.ok, c.message, live);
      return shots;
    } finally {
      quickBusy = false;
    }
  }

  const api: CaptureController = {
    get active() {
      return wrap !== null;
    },
    quick,
    open(list) {
      if (destroyed) return false;
      const live = list.filter((n) => n.isConnected);
      if (!live.length) return false;
      api.close();
      nodes = live;
      hideToast();
      mode = 'separate';
      phase = 'options';
      results = [];
      errors = [];
      attachError = '';
      progress = '';
      wrap = h(doc, 'div', 'pf-cap');
      frames = nodes.map(() => {
        const f = h(doc, 'div', 'pf-cap-frame');
        wrap!.appendChild(f);
        return f;
      });
      panel = unit(doc, { model: 'PF·SHOT', name: '07', cls: 'pf-cap-panel' });
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Captura de nodo');
      wrap.appendChild(panel);
      layer.appendChild(wrap);
      // Los marcos siguen al nodo mientras se hace scroll o se redimensiona (se liberan en close()).
      const follow = () => placeFrames();
      doc.addEventListener('scroll', follow, true);
      win.addEventListener('resize', follow);
      offs.push(
        () => doc.removeEventListener('scroll', follow, true),
        () => win.removeEventListener('resize', follow),
      );
      placeFrames();
      paint(true);
      opts.announce('Captura de nodo: elige las escalas.');
      return true;
    },
    close() {
      runId++; // anula un render en curso
      for (const f of offs) f();
      offs = [];
      hideToast();
      clearFrames();
      wrap?.remove();
      wrap = panel = null;
      nodes = [];
      results = [];
    },
    destroy() {
      destroyed = true;
      hideToast();
      api.close();
    },
  };
  return api;
}
