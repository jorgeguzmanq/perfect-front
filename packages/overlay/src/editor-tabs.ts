import { LIMITS } from '@perfect-front/shared';
import { downloadNameOf, formatBytes, imageToBlob, type PendingImage } from './attachments';
import { downloadAll, mountShotActions } from './clipboard';
import { growthPercent, renderTemplate } from './content-edit';
import { describe, h } from './dom';
import type { EditorCtx } from './editor-ctx';
import { bindingStep, queueFor, slugGroupId } from './groups';
import { icon, type IconName } from './icons';
import { ReorderModel } from './reorder';
import { foundationReference, inspectStyles, splitUnit, type StyleInspection } from './style-edit';

/** Cuerpos de las pestañas del editor v2. Cada función llena `box` y registra sus listeners. */

type Box = HTMLElement;

const btn = (ctx: EditorCtx, cls: string, label: string, onClick: () => void, ic?: IconName): HTMLButtonElement => {
  const b = h(ctx.doc, 'button', cls);
  b.type = 'button';
  if (ic) b.appendChild(icon(ctx.doc, ic, 13));
  if (label) b.appendChild(ctx.doc.createTextNode(ic ? ` ${label}` : label));
  ctx.on(b, 'click', onClick);
  return b;
};

const iconBtn = (ctx: EditorCtx, label: string, ic: IconName, onClick: () => void, disabled = false): HTMLButtonElement => {
  const b = h(ctx.doc, 'button', 'pf-ov-iconbtn');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.disabled = disabled;
  b.appendChild(icon(ctx.doc, ic, 14));
  ctx.on(b, 'click', onClick);
  return b;
};

const note = (ctx: EditorCtx, cls: string, text: string, ic?: IconName): HTMLElement => {
  const p = h(ctx.doc, 'p', cls);
  if (ic) p.appendChild(icon(ctx.doc, ic, 13));
  p.appendChild(h(ctx.doc, 'span', undefined, text));
  return p;
};

const errorMsg = (ctx: EditorCtx, text: string): HTMLElement => {
  const m = note(ctx, 'pf-ov-msg pf-ov-msg--err', text, 'warn');
  m.setAttribute('role', 'alert');
  return m;
};

const sect = (ctx: EditorCtx, title: string): HTMLElement => h(ctx.doc, 'div', 'pf-ov-sect', title);

// =============================================================================================
// Comentar
// =============================================================================================

function thumb(ctx: EditorCtx, m: PendingImage): HTMLElement {
  const doc = ctx.doc;
  const th = h(doc, 'div', 'pf-ov-th');
  const img = h(doc, 'span', 'pf-ov-th-img');
  img.style.backgroundImage = `url("${m.previewUrl}")`;
  th.appendChild(img);
  if (m.source === 'capture') th.appendChild(h(doc, 'span', 'pf-ov-th-k', 'captura'));
  const x = iconBtn(ctx, `Quitar ${m.name}`, 'close', () => {
    ctx.att.remove(m.clientId);
    ctx.rerender('body', 'tabs', 'inc');
  }, ctx.busy);
  x.classList.add('pf-ov-th-x');
  x.setAttribute('data-pf-remove-img', '');
  th.appendChild(x);
  const meta = h(doc, 'div', 'pf-ov-th-meta');
  const nm = h(doc, 'span', undefined, m.name);
  nm.title = m.name;
  meta.append(nm, h(doc, 'span', undefined, formatBytes(m.bytes)));
  th.appendChild(meta);
  const acts = h(doc, 'div', 'pf-ov-th-actions');
  mountShotActions(acts, { getBlob: () => imageToBlob(m), name: downloadNameOf(m), liveRoot: doc.body, onResult: (msg) => ctx.announce(msg) });
  th.appendChild(acts);
  // Reubicar entre secciones (solo si hay secciones).
  if (ctx.sections.items.length) {
    const sel = h(doc, 'select', 'pf-ov-th-move');
    sel.setAttribute('aria-label', `Mover ${m.name} a otra sección`);
    sel.disabled = ctx.busy;
    const opt = (value: string, label: string) => {
      const o = h(doc, 'option', undefined, label);
      o.value = value;
      o.selected = (m.sectionId ?? '') === value;
      sel.appendChild(o);
    };
    opt('', 'Suelta');
    ctx.sections.items.forEach((s, i) => opt(s.id, s.title.trim() || `Sección ${i + 1}`));
    ctx.on(sel, 'change', () => {
      ctx.att.moveTo(m.clientId, sel.value || null);
      ctx.rerender('body');
    });
    th.appendChild(sel);
  }
  return th;
}

function thumbs(ctx: EditorCtx, list: readonly PendingImage[]): HTMLElement | null {
  if (!list.length) return null;
  const g = h(ctx.doc, 'div', 'pf-ov-thumbs');
  for (const m of list) g.appendChild(thumb(ctx, m));
  return g;
}

function dropzone(ctx: EditorCtx, sectionId: string | null): HTMLElement {
  const doc = ctx.doc;
  const dz = h(doc, 'div', 'pf-ov-dz');
  dz.setAttribute('data-pf-dz', sectionId ?? '');
  if (ctx.att.full) {
    dz.classList.add('pf-ov-dz--full');
    dz.append(icon(doc, 'img', 18), h(doc, 'span', undefined, `Límite de ${LIMITS.attachments} imágenes alcanzado. Quita alguna para adjuntar otra.`));
    return dz;
  }
  // Mensaje de arrastre: se muestra por CSS al poner `pf-ov-dz--over` (sin redibujar durante el arrastre).
  const over = h(doc, 'div', 'pf-ov-dz-over');
  over.append(icon(doc, 'img', 22), h(doc, 'b', undefined, 'Suelta para adjuntar'), h(doc, 'span', undefined, 'PNG, JPG o WebP · hasta 5 MB c/u'));
  const idle = h(doc, 'div', 'pf-ov-dz-idle');
  const hint = h(doc, 'span');
  hint.append(h(doc, 'b', undefined, 'Pega'), ' (Ctrl+V), ', h(doc, 'b', undefined, 'arrastra'), ' o abre imágenes');
  idle.append(icon(doc, 'img', 18), hint);
  const input = h(doc, 'input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.multiple = true;
  input.hidden = true;
  ctx.on(input, 'change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    void ctx.addImages(files, 'open', sectionId);
  });
  const open = btn(ctx, 'pf-btn pf-btn--sm', 'Abrir…', () => input.click(), 'folder');
  open.disabled = ctx.busy;
  idle.append(input, open);
  if (ctx.canCapture) {
    const cam = btn(ctx, 'pf-btn pf-btn--sm', '', () => void ctx.captureImage(), 'cam');
    cam.title = 'Captura de la página';
    cam.setAttribute('aria-label', 'Captura de la página');
    cam.disabled = ctx.busy;
    idle.appendChild(cam);
  }
  if (ctx.captureNodes) idle.appendChild(captureMenu(ctx, sectionId));
  dz.append(over, idle);
  return dz;
}

/** «Capturar ▾»: menú con «Nodo seleccionado» (Alt+Mayús+S). El cierre por clic externo se libera con el cuerpo. */
function captureMenu(ctx: EditorCtx, sectionId: string | null): HTMLElement {
  const doc = ctx.doc;
  const wrap = h(doc, 'div', 'pf-ov-copywrap');
  const trigger = btn(ctx, 'pf-btn pf-btn--sm', 'Capturar ▾', () => {
    pop.hidden = !pop.hidden;
    trigger.setAttribute('aria-expanded', String(!pop.hidden));
  }, 'cam');
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.disabled = ctx.busy;
  const pop = h(doc, 'div', 'pf-ov-copypop');
  pop.hidden = true;
  const item = btn(ctx, 'pf-ov-cp', '', () => {
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    ctx.captureNodes?.(sectionId);
  });
  const t = h(doc, 'span', undefined, 'Nodo seleccionado');
  const k = h(doc, 'kbd', undefined, 'Alt+Mayús+S');
  item.append(t, k);
  pop.append(h(doc, 'h5', undefined, 'Capturar'), item);
  ctx.on(doc, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !pop.hidden) {
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  wrap.append(trigger, pop);
  return wrap;
}

export function renderComment(ctx: EditorCtx, box: Box): void {
  const doc = ctx.doc;
  const view = ctx.scope === 'view';
  const multi = ctx.sel.multi;

  const field = h(doc, 'div', ctx.error && !ctx.draft.trim() ? 'pf-ov-field pf-ov-field--bad' : 'pf-ov-field');
  const label = h(doc, 'label', 'pf-ov-sr-only', 'Comentario');
  label.htmlFor = 'pf-ov-comment';
  const ta = h(doc, 'textarea', 'pf-input pf-ov-textarea');
  ta.id = 'pf-ov-comment';
  ta.maxLength = LIMITS.comment;
  ta.rows = 5;
  ta.placeholder = view
    ? 'Qué habría que cambiar en esta vista…'
    : `Qué habría que cambiar ${multi ? 'en estos elementos' : 'en este elemento'}…`;
  ta.value = ctx.draft;
  ta.disabled = ctx.busy;
  const counter = h(doc, 'span', undefined, `${ctx.draft.length.toLocaleString('es')} / ${LIMITS.comment.toLocaleString('es')}`);
  const clear = btn(ctx, 'pf-ov-linkbtn', 'Descartar', () => {
    ctx.draft = '';
    ta.value = '';
    counter.textContent = `0 / ${LIMITS.comment.toLocaleString('es')}`;
    clear.disabled = true;
    ta.focus();
    ctx.announce('Texto descartado.');
  }, 'trash');
  clear.disabled = !ctx.draft || ctx.busy;
  ctx.on(ta, 'input', () => {
    ctx.draft = ta.value;
    counter.textContent = `${ta.value.length.toLocaleString('es')} / ${LIMITS.comment.toLocaleString('es')}`;
    clear.disabled = !ta.value || ctx.busy;
    if (ctx.error) {
      ctx.error = '';
      ctx.rerender('foot');
    }
  });
  const foot = h(doc, 'div', 'pf-ov-fieldfoot');
  foot.append(clear, counter);
  field.append(label, ta, foot);
  box.appendChild(field);

  if (ctx.imgError) box.appendChild(errorMsg(ctx, ctx.imgError));

  // Secciones: bloques extra con sus imágenes.
  ctx.sections.items.forEach((s, i) => {
    const sec = h(doc, 'div', 'pf-ov-section');
    const head = h(doc, 'div', 'pf-ov-section-head');
    const title = h(doc, 'input', 'pf-input');
    title.type = 'text';
    title.maxLength = LIMITS.sectionTitle;
    title.placeholder = `Título de la sección ${i + 1} (opcional)`;
    title.value = s.title;
    title.disabled = ctx.busy;
    title.setAttribute('aria-label', `Título de la sección ${i + 1}`);
    ctx.on(title, 'input', () => ctx.sections.update(s.id, { title: title.value }));
    const del = iconBtn(ctx, `Quitar la sección ${i + 1}`, 'trash', () => {
      ctx.att.releaseSection(s.id);
      ctx.sections.remove(s.id);
      ctx.rerender('body', 'inc');
    }, ctx.busy);
    head.append(title, del);
    const st = h(doc, 'textarea', 'pf-input pf-ov-textarea pf-ov-textarea--sm');
    st.maxLength = LIMITS.sectionText;
    st.rows = 3;
    st.value = s.text;
    st.disabled = ctx.busy;
    st.placeholder = 'Texto de la sección…';
    st.setAttribute('aria-label', `Texto de la sección ${i + 1}`);
    ctx.on(st, 'input', () => ctx.sections.update(s.id, { text: st.value }));
    sec.append(head, st, dropzone(ctx, s.id));
    const t = thumbs(ctx, ctx.att.inSection(s.id));
    if (t) sec.appendChild(t);
    box.appendChild(sec);
  });
  const add = btn(ctx, 'pf-btn pf-btn--sm', 'Añadir sección', () => {
    ctx.sections.add();
    ctx.rerender('body');
  }, 'plus');
  add.disabled = ctx.busy || ctx.sections.full;
  add.title = ctx.sections.full ? `Máximo ${LIMITS.sections} secciones` : 'Divide el comentario en bloques con sus propias imágenes';

  // Imágenes sueltas + contador.
  const sectHead = h(doc, 'div', 'pf-ov-sect');
  sectHead.append(h(doc, 'span', undefined, 'Imágenes'));
  const cnt = h(doc, 'span', ctx.att.full ? 'pf-ov-count pf-ov-count--full' : 'pf-ov-count', ctx.att.counter);
  cnt.setAttribute('aria-label', `${ctx.att.count} de ${LIMITS.attachments} imágenes`);
  sectHead.appendChild(cnt);
  if (ctx.att.count > 1) {
    sectHead.appendChild(btn(ctx, 'pf-ov-linkbtn', 'Descargar todas', () => {
      void downloadAll(ctx.att.items.map((m) => ({ src: imageToBlob(m), name: downloadNameOf(m) })));
      ctx.announce('Descargando imágenes');
    }, 'down'));
  }
  box.appendChild(sectHead);
  box.appendChild(dropzone(ctx, null));
  const loose = thumbs(ctx, ctx.att.inSection(null));
  if (loose) box.appendChild(loose);
  if (ctx.att.count) {
    const dest = h(doc, 'div', 'pf-ov-dest');
    dest.append(icon(doc, 'folder', 13), h(doc, 'span', undefined, 'Se copian a .perfect-front/attachments/ y quedan atadas a este comentario'));
    box.appendChild(dest);
  }
  box.appendChild(add);
}

// =============================================================================================
// Contenido
// =============================================================================================

const KIND_INFO = {
  fixed: ['Texto fijo', 'Escrito directo en el código', 'text'],
  i18n: ['Clave i18n', 'Se traduce desde archivos de idioma', 'globe'],
  dynamic: ['Dinámico', 'Mezcla texto fijo con datos', 'link'],
} as const;

export function renderContent(ctx: EditorCtx, box: Box): void {
  const doc = ctx.doc;
  const ed = ctx.edits()?.content ?? null;
  if (!ed) {
    const e = h(doc, 'div', 'pf-ov-empty');
    e.append(icon(doc, 'text', 26));
    const t = h(doc, 'div');
    t.append(h(doc, 'b', undefined, 'Este elemento no tiene texto propio'), doc.createElement('br'), 'Elige un botón, título o párrafo para editar su contenido.');
    e.appendChild(t);
    box.appendChild(e);
    return;
  }
  const info = ed.info;
  const [title, sub, ic] = KIND_INFO[info.kind];
  const where = info.kind === 'i18n' ? `locales/${ed.lang}.json` : (info.src ?? '');
  const head = h(doc, 'div', `pf-ov-ck pf-ov-ck--${info.kind}`);
  const hd = h(doc, 'div');
  hd.append(h(doc, 'b', undefined, title), h(doc, 'small', undefined, sub));
  const wh = h(doc, 'span', 'pf-ov-where', where);
  wh.title = where;
  head.append(icon(doc, ic, 15), hd, wh);
  box.appendChild(head);

  if (info.kind === 'i18n') {
    const key = h(doc, 'div', 'pf-ov-ckey');
    key.append(h(doc, 'code', undefined, info.key ?? ''));
    if (info.library) key.appendChild(h(doc, 'span', 'pf-ov-tagpill', info.library));
    if (info.uses !== null && info.uses !== undefined) key.appendChild(h(doc, 'span', 'pf-ov-hint', `en uso: ${info.uses}`));
    box.appendChild(key);
    const langs = h(doc, 'div', 'pf-ov-langs');
    langs.setAttribute('role', 'group');
    langs.setAttribute('aria-label', 'Idioma');
    for (const l of info.locales ?? []) {
      const b = h(doc, 'button', 'pf-ov-langbtn');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(l.locale === ed.lang));
      b.appendChild(h(doc, 'i', `pf-ov-dot ${ed.localeState(l.locale) ? `pf-ov-dot--${ed.localeState(l.locale)}` : ''}`));
      b.appendChild(doc.createTextNode(l.locale.toUpperCase()));
      ctx.on(b, 'click', () => {
        ed.setLang(l.locale);
        ctx.rerender('body');
      });
      langs.appendChild(b);
    }
    box.appendChild(langs);
  }

  const ta = h(doc, 'textarea', 'pf-input pf-ov-textarea pf-ov-ctext');
  ta.rows = 3;
  ta.maxLength = LIMITS.proposalText;
  ta.value = ed.value;
  ta.disabled = ctx.busy;
  ta.setAttribute('aria-label', 'Nuevo texto');
  if (info.kind === 'i18n' && ed.originalOf(ed.lang) === null) ta.placeholder = `Sin traducir. Escribe la traducción a ${ed.lang.toUpperCase()}…`;
  box.appendChild(ta);

  const dyn = h(doc, 'div', 'pf-ov-dyn');
  const diff = h(doc, 'div', 'pf-ov-diff-box');
  const paintDiff = () => {
    dyn.textContent = '';
    diff.textContent = '';
    const before = ed.originalOf(info.kind === 'i18n' ? ed.lang : '') ?? '';
    const after = ed.value;
    if (info.kind === 'dynamic') {
      const vars = h(doc, 'div', 'pf-ov-vars');
      vars.append(icon(doc, 'lock', 13), 'Variables fijas:');
      for (const [n, v] of Object.entries(info.variables ?? {})) {
        const c = h(doc, 'span', 'pf-ov-vchip', `{${n}}`);
        c.appendChild(h(doc, 'em', undefined, ` = ${v}`));
        vars.appendChild(c);
      }
      dyn.appendChild(vars);
      const miss = ed.missingVariables();
      if (miss.length) {
        dyn.appendChild(errorMsg(ctx, `Falta ${miss.map((m) => `{${m}}`).join(', ')} en el texto. Las variables vienen del código y no se pueden quitar.`));
      }
    }
    if (info.kind === 'i18n' && ed.originalOf(ed.lang) === null && !after) {
      diff.appendChild(note(ctx, 'pf-ov-msg pf-ov-msg--warn', `Falta la traducción a ${ed.lang.toUpperCase()}. En la página se ve el texto de respaldo.`, 'warn'));
      return;
    }
    if (before === after) {
      diff.appendChild(h(doc, 'p', 'pf-ov-hint', 'Sin cambios todavía. Escribe arriba y verás el resultado en la página.'));
      return;
    }
    const d = h(doc, 'div', 'pf-ov-diff');
    const a = h(doc, 'div');
    a.append(h(doc, 'small', undefined, 'Antes'), h(doc, 'del', undefined, before || '—'));
    const b = h(doc, 'div', 'pf-ov-diff-after');
    b.append(h(doc, 'small', undefined, 'Después'), h(doc, 'ins', undefined, after || '—'));
    d.append(a, b);
    diff.appendChild(d);
    const grow = growthPercent(before, after);
    if (grow) diff.appendChild(note(ctx, 'pf-ov-msg pf-ov-msg--warn', `${grow}% más largo: puede desbordar el diseño. Revísalo en la vista previa.`, 'warn'));
    if (info.kind === 'dynamic') {
      const p = h(doc, 'p', 'pf-ov-hint');
      p.append('Vista previa: ', h(doc, 'b', undefined, renderTemplate(after, info.variables ?? {})));
      diff.appendChild(p);
    }
  };
  paintDiff();
  box.append(dyn, diff);
  ctx.on(ta, 'input', () => {
    ed.setValue(ta.value);
    paintDiff();
    // Si el idioma activo cambió de «sin traducir» a escrito, el punto del selector cambia: solo pestañas/inc.
    ctx.rerender('tabs', 'inc');
  });

  if (info.kind === 'i18n') {
    box.appendChild(sect(ctx, 'Alcance del cambio'));
    const pick = h(doc, 'div', 'pf-ov-pick');
    const radio = (value: 'all' | 'one', t: string, help: string) => {
      const l = h(doc, 'label');
      const r = h(doc, 'input');
      r.type = 'radio';
      r.name = 'pf-ov-kscope';
      r.value = value;
      r.checked = ed.scope === value;
      ctx.on(r, 'change', () => ed.setScope(value));
      const s = h(doc, 'span');
      s.append(h(doc, 'b', undefined, t), doc.createElement('br'), h(doc, 'span', 'pf-ov-hint', help));
      l.append(r, s);
      return l;
    };
    pick.append(
      radio('all', 'Todas las apariciones', `La clave se usa en ${info.uses ?? 'varios'} lugares y cambiarían todos.`),
      radio('one', 'Solo aquí', `Se propone una clave nueva: ${ed.newKey ?? ''}.`),
    );
    box.appendChild(pick);
    const rows = h(doc, 'div', 'pf-ov-lrows');
    rows.setAttribute('aria-label', 'Todos los idiomas');
    for (const l of info.locales ?? []) {
      const v = ed.originalOf(l.locale);
      const r = h(doc, 'div');
      const cur = l.locale === ed.lang ? ed.value : '';
      const shown = cur || v || '';
      r.append(h(doc, 'b', undefined, l.locale.toUpperCase()), h(doc, 'span', shown ? '' : 'pf-ov-miss', shown || 'sin traducir'));
      rows.appendChild(r);
    }
    box.appendChild(rows);
  }
  box.appendChild(
    h(
      doc,
      'p',
      'pf-ov-hint',
      `Al guardar, el cambio viaja con el comentario como «antes → después».${ctx.draft.trim() ? '' : ' Si no escribes nada, se genera: «Cambiar texto de … a …».'}`,
    ),
  );
}

// =============================================================================================
// Estilos
// =============================================================================================

export function renderStyles(ctx: EditorCtx, box: Box, inspection: StyleInspection): void {
  const doc = ctx.doc;
  const ed = ctx.edits()?.style;
  if (!ed) return;
  const legend = h(doc, 'div', 'pf-ov-legend');
  const lg = (cls: string, ic: IconName, b: string, t: string) => {
    const d = h(doc, 'div', `pf-ov-lg ${cls}`);
    const s = h(doc, 'span');
    s.append(h(doc, 'b', undefined, b), t);
    d.append(icon(doc, ic, 14), s);
    return d;
  };
  legend.append(lg('pf-ov-lg--ed', 'style', 'Editable', 'Vive en el código del proyecto'), lg('pf-ov-lg--lk', 'lock', 'Foundation', 'Tokens, reset y librerías'));
  box.appendChild(legend);

  if (ctx.sel.multi) {
    const a = h(doc, 'div', 'pf-ov-applyto');
    a.appendChild(h(doc, 'span', undefined, 'Aplicar a'));
    const seg = h(doc, 'div', 'pf-ov-seg');
    const mk = (v: 'focus' | 'all', t: string) => {
      const b = h(doc, 'button', 'pf-ov-segbtn', t);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(ed.appliesTo === v));
      ctx.on(b, 'click', () => {
        ed.setAppliesTo(v);
        ctx.rerender('body');
      });
      return b;
    };
    seg.append(mk('focus', 'Solo el foco'), mk('all', `Los ${ctx.sel.size} elementos`));
    a.appendChild(seg);
    box.appendChild(a);
  }

  if (ed.count) {
    const s = h(doc, 'div', 'pf-ov-summ');
    const sp = h(doc, 'span');
    sp.append(h(doc, 'b', undefined, String(ed.count)), ` cambio${ed.count > 1 ? 's' : ''} propuesto${ed.count > 1 ? 's' : ''}. Vista previa activa; el código no se toca.`);
    s.append(icon(doc, 'style', 14), sp, btn(ctx, 'pf-ov-linkbtn', 'Revertir todo', () => {
      ed.revertAll();
      ctx.rerender('body', 'tabs', 'inc');
    }));
    box.appendChild(s);
  }

  if (!inspection.groups.length) box.appendChild(h(doc, 'p', 'pf-ov-hint', 'No se encontraron propiedades editables en este elemento.'));
  for (const g of inspection.groups) {
    const grp = h(doc, 'div', 'pf-ov-sgroup');
    grp.appendChild(h(doc, 'h6', undefined, g.name));
    for (const r of g.rows) {
      const c = ed.changes.get(r.property);
      const row = h(doc, 'div', c ? 'pf-ov-srow pf-ov-srow--chg' : 'pf-ov-srow');
      const sl = h(doc, 'div', 'pf-ov-sl');
      const small = h(doc, 'small');
      if (c) small.append(h(doc, 's', undefined, c.before), ` → ${c.after}`);
      else if (r.token) small.append('usa ', h(doc, 'span', 'pf-ov-tok', r.token));
      else small.textContent = r.sourceLabel ?? '';
      sl.append(h(doc, 'b', undefined, r.property), small);
      row.appendChild(sl);

      const cur = c ? c.after : r.value;
      let input: HTMLInputElement | HTMLSelectElement;
      if (r.kind === 'select') {
        const sel = h(doc, 'select');
        const opts = r.options ?? [];
        for (const o of opts.includes(cur) ? opts : [cur, ...opts]) {
          const op = h(doc, 'option', undefined, o);
          op.selected = o === cur;
          sel.appendChild(op);
        }
        input = sel;
      } else {
        const inp = h(doc, 'input');
        inp.type = r.kind === 'num' ? 'number' : 'text';
        inp.spellcheck = false;
        inp.value = r.kind === 'num' ? splitUnit(cur).n : cur;
        if (r.kind === 'num') inp.step = 'any';
        input = inp;
      }
      input.disabled = ctx.busy;
      input.setAttribute('aria-label', r.property);
      const unit = r.kind === 'num' ? splitUnit(r.value).unit : '';
      const commit = () => ed.set(r.property, r.kind === 'num' ? `${input.value}${unit}` : input.value);
      ctx.on(input, 'input', () => {
        commit();
        ctx.rerender('tabs', 'inc');
      });
      ctx.on(input, 'change', () => ctx.rerender('body'));
      const wrap = h(doc, 'span', r.kind === 'num' ? 'pf-ov-numw' : r.kind === 'color' ? 'pf-ov-colw' : 'pf-ov-selw');
      if (r.kind === 'color') {
        const sw = h(doc, 'i');
        sw.style.background = cur;
        wrap.appendChild(sw);
      }
      wrap.appendChild(input);
      if (unit) wrap.appendChild(h(doc, 'em', undefined, unit));
      row.appendChild(wrap);
      row.appendChild(iconBtn(ctx, `Revertir ${r.property}`, 'undo', () => {
        ed.revert(r.property);
        ctx.rerender('body', 'tabs', 'inc');
      }, !c));
      grp.appendChild(row);
    }
    box.appendChild(grp);
  }

  const fnd = h(doc, 'div', 'pf-ov-sgroup pf-ov-sgroup--fnd');
  const col = h(doc, 'button', 'pf-ov-collapse');
  col.type = 'button';
  col.setAttribute('aria-expanded', String(ctx.fndOpen));
  col.append(icon(doc, 'lock', 13), 'Foundations · solo lectura', h(doc, 'span', 'pf-ov-badge', String(inspection.foundations.length)), icon(doc, 'chev', 14));
  ctx.on(col, 'click', () => {
    ctx.fndOpen = !ctx.fndOpen;
    ctx.rerender('body');
  });
  fnd.appendChild(col);
  if (ctx.fndOpen) {
    for (const f of inspection.foundations) {
      const r = h(doc, 'div', 'pf-ov-fr');
      const v = h(doc, 'span', 'pf-ov-v');
      if (f.swatch) {
        const s = h(doc, 'i');
        s.style.background = f.swatch;
        v.appendChild(s);
      }
      v.appendChild(doc.createTextNode(f.value));
      r.append(
        h(doc, 'b', undefined, f.property),
        v,
        h(doc, 'small', undefined, f.sourceLabel),
        btn(ctx, 'pf-btn pf-btn--sm', 'Comentar', () => {
          ctx.draft = `${ctx.draft}${ctx.draft && !ctx.draft.endsWith('\n') ? '\n' : ''}${foundationReference(f)}`.slice(0, LIMITS.comment);
          ctx.tab = 'comment';
          ctx.rerender('tabs', 'body');
        }),
      );
      r.lastElementChild?.setAttribute('title', 'Agregar la referencia al comentario');
      fnd.appendChild(r);
    }
  }
  box.appendChild(fnd);
}

export const inspectFor = (el: Element): StyleInspection => inspectStyles(el);

// =============================================================================================
// Estructura
// =============================================================================================

export function renderStruct(ctx: EditorCtx, box: Box): void {
  const doc = ctx.doc;
  const ed = ctx.edits();
  const node = ctx.sel.focus;
  if (!ed || !node) return;
  const el = node.el;
  if (!ed.reorder) ed.reorder = new ReorderModel(el);
  const rm = ed.reorder;
  const parent = el.parentElement;

  // Ruta (migas): subir al ancestro es navegar, no reordenar.
  const crumbs = h(doc, 'nav', 'pf-ov-crumbs');
  crumbs.setAttribute('aria-label', 'Ruta');
  const chain: Element[] = [];
  for (let c: Element | null = parent; c && c !== doc.documentElement && chain.length < 3; c = c.parentElement) chain.unshift(c);
  chain.forEach((c, i) => {
    if (i) crumbs.appendChild(h(doc, 'i', undefined, '›'));
    const b = h(doc, 'button', undefined, describe(c));
    b.type = 'button';
    ctx.on(b, 'click', () => ctx.retarget(c));
    crumbs.appendChild(b);
  });
  if (chain.length) box.appendChild(crumbs);

  const pb = h(doc, 'div', 'pf-ov-parentbox');
  const head = h(doc, 'header');
  head.append(icon(doc, 'layers', 13), doc.createTextNode(parent ? describe(parent) : 'documento'));
  head.appendChild(h(doc, 'span', undefined, `${rm.siblingCount} hijos · arrastra o usa los botones`));
  pb.appendChild(head);

  const order = rm.virtualOrder;
  order.forEach((s, i) => {
    const isMe = s === rm.moved;
    const row = h(doc, 'div', 'pf-ov-sib');
    if (isMe) row.setAttribute('aria-current', 'true');
    if (isMe && rm.changed) row.classList.add('pf-ov-sib--moved');
    row.draggable = isMe;
    row.append(
      (() => {
        const g = h(doc, 'span', 'pf-ov-g');
        g.appendChild(icon(doc, 'grip', 14));
        return g;
      })(),
      h(doc, 'span', 'pf-ov-i', String(i + 1)),
    );
    const l = h(doc, 'span', 'pf-ov-l', describe(s));
    const txt = (s.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (txt) l.appendChild(h(doc, 'small', undefined, txt));
    row.appendChild(l);
    if (isMe) {
      const btns = h(doc, 'span', 'pf-ov-btns');
      btns.append(
        iconBtn(ctx, 'Mover antes', 'up', () => {
          rm.moveUp();
          ctx.rerender('body', 'tabs', 'inc');
          ctx.focusNode(el);
        }, !rm.canUp || ctx.busy),
        iconBtn(ctx, 'Mover después', 'down', () => {
          rm.moveDown();
          ctx.rerender('body', 'tabs', 'inc');
          ctx.focusNode(el);
        }, !rm.canDown || ctx.busy),
      );
      row.appendChild(btns);
      ctx.on(row, 'dragstart', (e) => {
        (e as DragEvent).dataTransfer?.setData('text/plain', 'pf-reorder');
        const dt = (e as DragEvent).dataTransfer;
        if (dt) dt.effectAllowed = 'move';
      });
    } else {
      row.appendChild(btn(ctx, 'pf-btn pf-btn--ghost pf-btn--sm', 'Ir', () => ctx.retarget(s)));
    }
    ctx.on(row, 'dragover', (e) => e.preventDefault());
    ctx.on(row, 'drop', (e) => {
      e.preventDefault();
      if (rm.dropOn(s)) {
        ctx.rerender('body', 'tabs', 'inc');
        ctx.focusNode(el);
      }
    });
    pb.appendChild(row);
  });
  box.appendChild(pb);

  if (rm.changed) {
    const m = h(doc, 'div', 'pf-ov-mvnote');
    const sp = h(doc, 'span');
    sp.append('Propuesta: mover ', h(doc, 'b', undefined, describe(el)), ' de la posición ', h(doc, 'b', undefined, String(rm.from)), ' a la ', h(doc, 'b', undefined, `${rm.to}.`));
    m.append(icon(doc, 'move', 14), sp, btn(ctx, 'pf-ov-linkbtn', 'Deshacer', () => {
      rm.undo();
      ctx.rerender('body', 'tabs', 'inc');
      ctx.focusNode(el);
    }));
    box.appendChild(m);
  } else {
    const p = h(doc, 'p', 'pf-ov-hint');
    p.append('Reordenar es una ', h(doc, 'b', undefined, 'propuesta'), ': se previsualiza en la página y viaja con el comentario. El código no cambia.');
    box.appendChild(p);
  }
  box.appendChild(h(doc, 'p', 'pf-ov-hint', 'Las flechas ↑↓ siguen subiendo al padre y bajando al hijo; ←→ cambian de hermano sin reordenar.'));
}

// =============================================================================================
// Cola
// =============================================================================================

export function renderQueue(ctx: EditorCtx, box: Box): void {
  const doc = ctx.doc;
  const port = ctx.groupsPort;
  if (!port) {
    box.appendChild(note(ctx, 'pf-ov-hint', 'Los grupos no están disponibles en este momento.'));
    return;
  }
  const b = ctx.binding;
  const groups = port.groups();
  const comments = port.comments();

  if (!b) {
    const e = h(doc, 'div', 'pf-ov-empty');
    e.append(icon(doc, 'queue', 26));
    const t = h(doc, 'div');
    t.append(h(doc, 'b', undefined, 'Este comentario va suelto'), doc.createElement('br'), 'Átalo a un grupo para que se lea junto con otros, en orden y con contexto.');
    e.appendChild(t);
    const row = h(doc, 'div', 'pf-ov-row');
    row.append(
      btn(ctx, 'pf-btn', 'Grupo nuevo', () => newGroupForm(ctx, box), 'plus'),
      (() => {
        const j = btn(ctx, 'pf-btn', 'Añadir a un grupo', () => {
          const first = groups[0];
          if (!first) return;
          ctx.binding = { groupId: first.id, afterId: null };
          ctx.rerender('body', 'inc', 'foot');
        }, 'link');
        j.disabled = groups.length === 0;
        if (!groups.length) j.title = 'Aún no hay grupos';
        return j;
      })(),
    );
    e.appendChild(row);
    box.appendChild(e);
    return;
  }

  const group = groups.find((g) => g.id === b.groupId) ?? null;
  const name = group?.name ?? b.create?.name ?? b.groupId;

  // Selector de grupo + salir.
  const gsel = h(doc, 'div', 'pf-ov-gsel');
  const sel = h(doc, 'select');
  sel.setAttribute('aria-label', 'Grupo');
  const ids = new Set(groups.map((g) => g.id as string));
  if (!ids.has(b.groupId)) {
    const o = h(doc, 'option', undefined, `${b.groupId}: ${name}`);
    o.value = b.groupId;
    o.selected = true;
    sel.appendChild(o);
  }
  for (const g of groups) {
    const o = h(doc, 'option', undefined, `${g.id}: ${g.name}`);
    o.value = g.id;
    o.selected = g.id === b.groupId;
    sel.appendChild(o);
  }
  const nw = h(doc, 'option', undefined, '+ Grupo nuevo…');
  nw.value = '__new';
  sel.appendChild(nw);
  ctx.on(sel, 'change', () => {
    if (sel.value === '__new') {
      newGroupForm(ctx, box);
      return;
    }
    ctx.binding = { groupId: sel.value, afterId: null };
    ctx.rerender('body', 'inc', 'foot');
  });
  gsel.append(sel, iconBtn(ctx, 'Sacar del grupo', 'close', () => {
    ctx.binding = null;
    ctx.rerender('body', 'inc', 'foot', 'tabs');
  }));
  box.appendChild(gsel);

  box.appendChild(sect(ctx, 'Contexto del grupo'));
  const noteTa = h(doc, 'textarea', 'pf-input pf-ov-textarea pf-ov-gnote');
  noteTa.rows = 3;
  noteTa.maxLength = LIMITS.groupNote;
  noteTa.value = group?.note ?? '';
  noteTa.setAttribute('aria-label', 'Contexto del grupo');
  noteTa.disabled = !group || ctx.busy;
  if (!group) noteTa.placeholder = 'Se podrá escribir cuando el grupo exista (al guardar).';
  ctx.on(noteTa, 'change', () => {
    if (group) void port.api.updateGroup(group.id, { note: noteTa.value }).catch(() => ctx.announce('No se pudo guardar la nota del grupo.'));
  });
  box.appendChild(noteTa);

  const tgl = h(doc, 'label', 'pf-ov-tgl');
  const tl = h(doc, 'span');
  tl.append('Entender el grupo antes de actuar', h(doc, 'small', undefined, 'Quien ejecute lee la nota y toda la cola, en orden'));
  const sw = h(doc, 'input', 'pf-ov-sw');
  sw.type = 'checkbox';
  sw.setAttribute('role', 'switch');
  sw.checked = group?.readFirst ?? true;
  sw.disabled = !group || ctx.busy;
  ctx.on(sw, 'change', () => {
    if (group) void port.api.updateGroup(group.id, { readFirst: sw.checked }).catch(() => ctx.announce('No se pudo guardar el ajuste del grupo.'));
  });
  tgl.append(tl, sw);
  box.appendChild(tgl);

  // Cola de lectura con este comentario insertado en su paso.
  const queue = queueFor(b.groupId, comments);
  const step = bindingStep(b, queue);
  const head = h(doc, 'div', 'pf-ov-sect');
  head.appendChild(h(doc, 'span', undefined, 'Cola de lectura'));
  head.appendChild(btn(ctx, 'pf-ov-linkbtn', 'Atar a un comentario…', () => {
    ctx.tab = 'queue';
    attachPicker(ctx, box, queue, comments);
  }));
  box.appendChild(head);
  const list = h(doc, 'div', 'pf-ov-q');
  const me = h(doc, 'div', 'pf-ov-qi pf-ov-qi--me');
  const meC = h(doc, 'div', 'pf-ov-qc');
  meC.append(h(doc, 'p', undefined, ctx.draft.trim() || 'Este comentario (borrador)'), h(doc, 'small', undefined, `nuevo · ${ctx.sel.focus ? describe(ctx.sel.focus.el) : 'vista'}`));
  me.append(h(doc, 'span', 'pf-ov-qn', String(step)), meC);
  const rows = queue.map((c, i) => {
    const qi = h(doc, 'div', c.status === 'resolved' ? 'pf-ov-qi pf-ov-qi--done' : 'pf-ov-qi');
    const qc = h(doc, 'div', 'pf-ov-qc');
    const small = h(doc, 'small');
    small.append(h(doc, 'span', `pf-chip pf-chip--${c.status}`, STATUS_LABEL[c.status] ?? c.status), ` ${c.location.selector ? c.location.selector.split(' > ').pop()! : 'vista'}`);
    qc.append(h(doc, 'p', undefined, c.comment.slice(0, 140)), small);
    qi.append(h(doc, 'span', 'pf-ov-qn', String(i + 1)), qc);
    return qi;
  });
  rows.splice(Math.min(step - 1, rows.length), 0, me);
  rows.forEach((r, i) => {
    const qn = r.querySelector('.pf-ov-qn');
    if (qn) qn.textContent = String(i + 1);
    list.appendChild(r);
  });
  box.appendChild(list);
}

const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', in_progress: 'En curso', resolved: 'Resuelto', ignored: 'Ignorado', archived: 'Archivado' };

function newGroupForm(ctx: EditorCtx, box: Box): void {
  const doc = ctx.doc;
  const port = ctx.groupsPort;
  if (!port) return;
  box.textContent = '';
  box.appendChild(sect(ctx, 'Grupo nuevo'));
  const name = h(doc, 'input', 'pf-input');
  name.type = 'text';
  name.maxLength = LIMITS.groupName;
  name.placeholder = 'Nombre del grupo (p. ej. Rediseño de precios)';
  name.setAttribute('aria-label', 'Nombre del grupo');
  const row = h(doc, 'div', 'pf-ov-row');
  const ok = btn(ctx, 'pf-btn pf-btn--primary', 'Crear', () => {
    const n = name.value.trim();
    if (!n) {
      name.focus();
      return;
    }
    // El grupo se crea al guardar el comentario: si se cancela el editor no queda un grupo vacío.
    const id = slugGroupId(n, new Set(port.groups().map((g) => g.id as string)));
    ctx.binding = { groupId: id, afterId: null, create: { name: n } };
    ctx.rerender('body', 'inc', 'foot', 'tabs');
  });
  row.append(btn(ctx, 'pf-btn pf-btn--ghost', 'Volver', () => ctx.rerender('body')), ok);
  ctx.on(name, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      ok.click();
    }
  });
  box.append(name, row);
  name.focus();
}

function attachPicker(
  ctx: EditorCtx,
  box: Box,
  queue: ReturnType<typeof queueFor>,
  comments: ReturnType<NonNullable<EditorCtx['groupsPort']>['comments']>,
): void {
  const doc = ctx.doc;
  const b = ctx.binding;
  if (!b) return;
  box.textContent = '';
  box.appendChild(sect(ctx, 'Atar a un comentario'));
  box.appendChild(h(doc, 'p', 'pf-ov-hint', 'Se coloca justo después del elegido'));
  const pick = h(doc, 'div', 'pf-ov-pick');
  let chosen: { afterId: string | null; joinWith?: string } = { afterId: b.afterId };
  const option = (label: string, help: string, tag: string | null, value: { afterId: string | null; joinWith?: string }, checked: boolean) => {
    const l = h(doc, 'label');
    const r = h(doc, 'input');
    r.type = 'radio';
    r.name = 'pf-ov-pk';
    r.checked = checked;
    ctx.on(r, 'change', () => (chosen = value));
    const s = h(doc, 'span');
    s.append(h(doc, 'b', undefined, label), doc.createElement('br'), h(doc, 'span', 'pf-ov-hint', help.slice(0, 120)));
    if (tag) s.append(doc.createElement('br'), h(doc, 'span', 'pf-ov-tagpill', tag));
    l.append(r, s);
    pick.appendChild(l);
  };
  queue.forEach((c, i) => option(`Después de #${i + 1}`, c.comment, `Grupo ${b.groupId}`, { afterId: c.id }, b.afterId === c.id));
  const free = comments.filter((c) => !c.group && (c.status === 'pending' || c.status === 'in_progress')).slice(0, 8);
  for (const c of free) option(`${c.id.slice(-6)} · sin grupo`, c.comment, 'Se crea un grupo con ambos', { afterId: c.id, joinWith: c.id }, false);
  if (!queue.length && !free.length) pick.appendChild(h(doc, 'p', 'pf-ov-hint', 'No hay otros comentarios abiertos para atar.'));
  box.appendChild(pick);
  const row = h(doc, 'div', 'pf-ov-row');
  row.append(
    btn(ctx, 'pf-btn pf-btn--ghost', 'Volver', () => ctx.rerender('body')),
    btn(ctx, 'pf-btn pf-btn--primary', 'Atar', () => {
      ctx.binding = {
        groupId: b.groupId,
        afterId: chosen.afterId,
        ...(b.create ? { create: b.create } : {}),
        ...(chosen.joinWith ? { joinWith: chosen.joinWith } : {}),
      };
      ctx.rerender('body', 'inc', 'foot');
    }),
  );
  box.appendChild(row);
}
