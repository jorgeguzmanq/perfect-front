import { formatBytes } from './attachments';
import {
  formatSize,
  scaleOptions,
  scaleOptionsForEach,
  unionBox,
  type CaptureScale,
  type ScaleOption,
} from './capture-scale';
import { boxOf, nodeLabel, renderBox, revealNode, type RenderedShot } from './capture-node';
import { describe, h } from './dom';
import { icon } from './icons';
import type { CapturedShot, ShotCard } from './types';

type Mode = 'separate' | 'join';
type Phase = 'options' | 'run' | 'done';

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
  close(): void;
  destroy(): void;
}

/** Capa de captura: marco(s) sobre el nodo, barra de escalas y tarjeta de resultado. Vive en el Shadow DOM del overlay. */
export function createCaptureController(opts: CaptureControllerOptions): CaptureController {
  const { doc, layer } = opts;
  const win = doc.defaultView ?? window;

  let nodes: Element[] = [];
  let mode: Mode = 'separate';
  const picked = new Set<CaptureScale>([2]);
  let phase: Phase = 'options';
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
    const boxes = frameBoxes();
    if (mode === 'join' || boxes.length <= 1) {
      const u = unionBox(boxes);
      return scaleOptions(u?.width ?? 1, u?.height ?? 1);
    }
    return scaleOptionsForEach(boxes);
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

  const button = (cls: string, text: string, onClick: () => void, ic?: Parameters<typeof icon>[1]) => {
    const b = h(doc, 'button', cls);
    b.type = 'button';
    if (ic) b.appendChild(icon(doc, ic, 14));
    b.appendChild(h(doc, 'span', undefined, text));
    b.addEventListener('click', onClick);
    return b;
  };

  const heading = (title: string, sub: string) => {
    const head = h(doc, 'div', 'pf-cap-head');
    head.appendChild(icon(doc, 'cam', 16));
    const id = h(doc, 'div', 'pf-cap-id');
    id.append(h(doc, 'b', undefined, title), h(doc, 'small', undefined, sub));
    const x = h(doc, 'button', 'pf-ov-iconbtn');
    x.type = 'button';
    x.setAttribute('aria-label', 'Cerrar captura');
    x.appendChild(icon(doc, 'close', 14));
    x.addEventListener('click', () => api.close());
    head.append(id, x);
    return head;
  };

  const nodesSummary = () => {
    if (nodes.length > 1) return `${nodes.length} nodos`;
    const el = nodes[0];
    const b = el ? boxOf(el) : null;
    return el && b ? `${describe(el)} · ${formatSize(b)} px` : '';
  };

  // --- Vistas --------------------------------------------------------------------------------------

  const renderOptions = (box: HTMLElement) => {
    box.appendChild(heading('Capturar nodo', nodesSummary()));

    if (nodes.length > 1) {
      const grp = h(doc, 'div', 'pf-cap-modes');
      grp.setAttribute('role', 'radiogroup');
      grp.setAttribute('aria-label', 'Varios nodos');
      for (const [m, label] of [['separate', 'Por separado'], ['join', 'Juntos']] as const) {
        const b = h(doc, 'button', 'pf-btn pf-btn--sm' + (mode === m ? ' pf-btn--on' : ''), label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(mode === m));
        b.addEventListener('click', () => {
          mode = m;
          paint();
        });
        grp.appendChild(b);
      }
      box.appendChild(grp);
    }

    const opts_ = options();
    const list = h(doc, 'div', 'pf-cap-scales');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Escalas');
    for (const o of opts_) {
      const label = h(doc, 'label', 'pf-cap-scale' + (o.enabled ? '' : ' pf-cap-scale--off'));
      const input = h(doc, 'input');
      input.type = 'checkbox';
      input.checked = o.enabled && picked.has(o.scale);
      input.disabled = !o.enabled;
      input.addEventListener('change', () => {
        if (input.checked) picked.add(o.scale);
        else picked.delete(o.scale);
        paint();
      });
      const text = h(doc, 'span', 'pf-cap-scale-t');
      text.append(
        h(doc, 'b', undefined, `${o.scale}×`),
        h(doc, 'small', undefined, o.enabled ? `${formatSize(o)} px` : `${formatSize(o)} px · ${o.reason ?? 'no disponible'}`),
      );
      label.append(input, text);
      list.appendChild(label);
    }
    box.appendChild(list);

    const n = opts_.filter((o) => o.enabled && picked.has(o.scale)).length;
    const total = n * (mode === 'separate' ? nodes.length : 1);
    if (errors.length) box.appendChild(h(doc, 'p', 'pf-cap-err', errors.join(' · ')));
    const foot = h(doc, 'div', 'pf-cap-foot');
    const go = button('pf-btn pf-btn--on', total > 1 ? `Capturar ${total} imágenes` : 'Capturar', () => void run(), 'cam');
    go.disabled = total === 0;
    foot.append(button('pf-btn', 'Cancelar', () => api.close()), go);
    box.appendChild(foot);
    queueMicrotask(() => go.isConnected && !go.disabled && go.focus());
  };

  const renderRun = (box: HTMLElement) => {
    box.appendChild(heading('Renderizando…', 'A cada escala se re-dibuja la página; no se estira una imagen'));
    const p = h(doc, 'p', 'pf-cap-progress', progress);
    p.setAttribute('role', 'status');
    box.appendChild(p);
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
    const list = h(doc, 'ul', 'pf-cap-shots');
    for (const s of results) {
      const li = h(doc, 'li', 'pf-cap-shot');
      const img = h(doc, 'img', 'pf-cap-thumb');
      img.src = `data:${s.mimeType};base64,${s.dataBase64}`;
      img.alt = '';
      const meta = h(doc, 'span', 'pf-cap-meta');
      meta.append(h(doc, 'b', undefined, s.name), h(doc, 'small', undefined, `${formatSize(s)} px · ${formatBytes(s.bytes)}`));
      li.append(img, meta);
      list.appendChild(li);
    }
    box.appendChild(list);
    const msgs = [...errors, ...(attachError ? [attachError] : [])];
    if (msgs.length) {
      const e = h(doc, 'p', 'pf-cap-err', msgs.join(' · '));
      e.setAttribute('role', 'alert');
      box.appendChild(e);
    }
    // Enganche: aquí se añaden Copiar / Descargar.
    const actions = h(doc, 'div', 'pf-ov-shot-actions');
    box.appendChild(actions);
    const foot = h(doc, 'div', 'pf-cap-foot');
    const attach = button('pf-btn pf-btn--on', ok ? `Adjuntar ${ok}` : 'Adjuntar', () => doAttach(), 'img');
    attach.disabled = ok === 0;
    foot.append(
      button('pf-btn', 'Capturar de nuevo', () => retake(), 'cam'),
      button('pf-btn pf-btn--ghost', 'Cerrar', () => api.close()),
      attach,
    );
    box.appendChild(foot);
    queueMicrotask(() => attach.isConnected && !attach.disabled && attach.focus());
    try {
      opts.onShotCard?.(cardHandle(box, actions));
    } catch {
      /* un enganche externo no debe romper la tarjeta */
    }
  };

  function paint() {
    if (!panel) return;
    panel.textContent = '';
    panel.setAttribute('data-phase', phase);
    if (phase === 'options') renderOptions(panel);
    else if (phase === 'run') renderRun(panel);
    else renderDone(panel);
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
    results = [];
    errors = [];
    attachError = '';
    // La capa (marcos) solo se ve hasta aquí. La página real no se toca: los nodos propios se excluyen con el filtro.
    setFramesHidden(true);
    const groups = mode === 'join' ? [live] : live.map((n) => [n]);
    const jobs = groups.length * scales.length;
    let done = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      const base = group.length > 1 ? 'nodos' : nodeLabel(group[0]!);
      const label = mode === 'separate' && live.length > 1 ? `${gi + 1}-${base}` : base;
      for (const scale of scales) {
        progress = `${scale}× · ${label} (${done + 1} de ${jobs})`;
        paint();
        try {
          await revealNode(group[0]!, win);
          const u = unionBox(group.map(boxOf));
          if (!u) throw new Error('el nodo ya no está en la página');
          const shot = await renderBox(u, scale, label, win);
          if (my !== runId || destroyed) return;
          results.push(shot);
        } catch (e) {
          if (my !== runId || destroyed) return;
          errors.push(`${label} ${scale}×: ${e instanceof Error ? e.message : 'falló el renderizado'}`);
        }
        done++;
      }
    }
    if (my !== runId || destroyed) return;
    phase = 'done';
    paint();
    opts.announce(results.length ? `${results.length} capturas listas.` : 'No se pudo capturar.');
  }

  function retake() {
    runId++;
    phase = 'options';
    results = [];
    errors = [];
    attachError = '';
    setFramesHidden(false);
    paint();
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

  const api: CaptureController = {
    get active() {
      return wrap !== null;
    },
    open(list) {
      if (destroyed) return false;
      const live = list.filter((n) => n.isConnected);
      if (!live.length) return false;
      api.close();
      nodes = live;
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
      panel = h(doc, 'div', 'pf-cap-panel');
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
      paint();
      opts.announce('Captura de nodo: elige las escalas.');
      return true;
    },
    close() {
      runId++; // anula un render en curso
      for (const f of offs) f();
      offs = [];
      clearFrames();
      wrap?.remove();
      wrap = panel = null;
      nodes = [];
      results = [];
    },
    destroy() {
      destroyed = true;
      api.close();
    },
  };
  return api;
}
