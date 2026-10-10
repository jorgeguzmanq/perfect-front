import { LIMITS, type CommentProposal } from '@perfect-front/shared';
import { localId, parseSrc } from './dom';

/**
 * Pestaña Contenido: texto fijo, clave i18n y texto dinámico (con variables). Genera propuestas
 * «antes → después»; la vista previa en la página es reversible y nunca toca el código fuente.
 *
 * La detección es por anotaciones del DOM (las pone el plugin de build o el proyecto):
 *   data-i18n | data-i18n-key | data-pf-i18n="clave"   -> clave i18n (data-pf-i18n-lib = librería)
 *   data-pf-locales='{"es":"..","en":".."}'            -> valores actuales por idioma (si se conocen)
 *   data-pf-template="Hay {count} planes" + data-pf-vars='{"count":"3"}' -> dinámico
 * Sin anotaciones, el texto propio del elemento es «texto fijo».
 */

export type ContentKind = 'fixed' | 'i18n' | 'dynamic';

export interface ContentInfo {
  kind: ContentKind;
  /** Texto original (en i18n: el del idioma activo). */
  original: string;
  src: string | null;
  key?: string;
  library?: string | null;
  uses?: number | null;
  /** Idiomas conocidos y su valor original (null = sin traducir). */
  locales?: Array<{ locale: string; before: string | null }>;
  activeLocale?: string;
  variables?: Record<string, string>;
}

type TextProposal = Extract<CommentProposal, { kind: 'text_fixed' | 'text_dynamic' | 'text_i18n' }>;

const I18N_ATTRS = ['data-pf-i18n', 'data-i18n-key', 'data-i18n'];

function ownTextNodes(el: Element): Text[] {
  return Array.from(el.childNodes).filter((n): n is Text => n.nodeType === 3 && !!(n.nodeValue ?? '').trim());
}

/** Texto propio (nodos de texto directos). null si el elemento no tiene. */
export function ownText(el: Element): string | null {
  const t = ownTextNodes(el)
    .map((n) => n.nodeValue ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

function jsonAttr(el: Element, name: string): Record<string, string> | null {
  const raw = el.getAttribute(name);
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string' || typeof val === 'number') out[k] = String(val);
    return out;
  } catch {
    return null;
  }
}

export function detectContent(el: Element): ContentInfo | null {
  const text = ownText(el);
  const src = el.getAttribute('data-pf-src');
  const template = el.getAttribute('data-pf-template');
  const vars = jsonAttr(el, 'data-pf-vars');
  if (template && vars && Object.keys(vars).length) {
    return { kind: 'dynamic', original: template, src, variables: vars };
  }
  const keyAttr = I18N_ATTRS.find((a) => el.getAttribute(a));
  if (keyAttr) {
    const key = el.getAttribute(keyAttr)!.slice(0, 200);
    const doc = el.ownerDocument;
    const active = (doc.documentElement.lang || 'es').slice(0, 2).toLowerCase();
    const known = jsonAttr(el, 'data-pf-locales');
    const locales = known
      ? Object.entries(known).map(([locale, before]) => ({ locale, before }))
      : [{ locale: active, before: text ?? '' }];
    if (!locales.some((l) => l.locale === active)) locales.unshift({ locale: active, before: text ?? '' });
    let uses: number | null = null;
    try {
      uses = doc.querySelectorAll(I18N_ATTRS.map((a) => `[${a}="${key.replace(/["\\]/g, '\\$&')}"]`).join(',')).length;
    } catch {
      /* clave con caracteres raros: sin conteo */
    }
    const lib = el.getAttribute('data-pf-i18n-lib');
    return {
      kind: 'i18n',
      original: locales.find((l) => l.locale === active)?.before ?? text ?? '',
      src,
      key,
      library: lib ? lib.slice(0, 80) : null,
      uses,
      locales,
      activeLocale: active,
    };
  }
  if (!text) return null;
  return { kind: 'fixed', original: text, src };
}

/** Sustituye `{var}` por su valor (vista previa de dinámicos). */
export const renderTemplate = (tpl: string, vars: Record<string, string>): string =>
  tpl.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => (vars[k] !== undefined ? vars[k]! : m));

/** Aviso de desborde: el texto nuevo es >25 % más largo (y al menos 6 caracteres más). Devuelve el % o 0. */
export function growthPercent(before: string, after: string): number {
  if (!before || after.length <= before.length * 1.25 || after.length - before.length < 6) return 0;
  return Math.round((after.length / before.length - 1) * 100);
}

export class ContentEditor {
  readonly info: ContentInfo;
  /** Valor editado por idioma (en fixed/dynamic, solo la clave ''). */
  private values = new Map<string, string>();
  lang: string;
  scope: 'all' | 'one' = 'all';
  private saved: Array<{ node: Text; value: string }> = [];

  constructor(
    private readonly el: Element,
    info: ContentInfo,
  ) {
    this.info = info;
    this.lang = info.activeLocale ?? '';
    for (const l of info.locales ?? []) this.values.set(l.locale, l.before ?? '');
    if (info.kind !== 'i18n') this.values.set('', info.original);
  }

  private get slot(): string {
    return this.info.kind === 'i18n' ? this.lang : '';
  }

  get value(): string {
    return this.values.get(this.slot) ?? '';
  }

  setValue(v: string): void {
    this.values.set(this.slot, v.slice(0, LIMITS.proposalText));
    this.applyPreview();
  }

  setLang(l: string): void {
    this.lang = l;
  }
  setScope(s: 'all' | 'one'): void {
    this.scope = s;
  }

  /** Valor original del idioma (o del texto) activo; null = sin traducir. */
  originalOf(locale: string): string | null {
    if (this.info.kind !== 'i18n') return this.info.original;
    return this.info.locales?.find((l) => l.locale === locale)?.before ?? null;
  }

  /** Cambió el idioma/valor respecto del original. */
  private changedIn(locale: string): boolean {
    const now = this.values.get(locale) ?? '';
    return now !== (this.originalOf(locale) ?? '');
  }

  get changeCount(): number {
    if (this.info.kind !== 'i18n') return this.changedIn('') ? 1 : 0;
    return (this.info.locales ?? []).filter((l) => this.changedIn(l.locale)).length;
  }

  /** Estado del punto del selector de idioma: editada / pendiente (sin traducir) / sin cambios. */
  localeState(locale: string): 'ed' | 'miss' | '' {
    if (this.changedIn(locale)) return 'ed';
    return this.originalOf(locale) === null && !(this.values.get(locale) ?? '') ? 'miss' : '';
  }

  /** Variables que el texto dinámico dejó de contener (deben conservarse). */
  missingVariables(): string[] {
    const vars = this.info.variables;
    if (!vars) return [];
    const v = this.value;
    return Object.keys(vars).filter((n) => !v.includes(`{${n}}`));
  }

  get valid(): boolean {
    return this.missingVariables().length === 0;
  }

  /** Clave nueva propuesta para «Solo aquí». */
  get newKey(): string | null {
    return this.info.key ? `${this.info.key}_2`.slice(0, 200) : null;
  }

  /** Texto «Cambiar texto de … a …» si la persona no escribió comentario. */
  autoComment(): string | null {
    if (!this.changeCount) return null;
    const before = this.originalOf(this.slot) ?? '';
    const cut = (t: string) => (t.length > 80 ? `${t.slice(0, 79)}…` : t);
    return `Cambiar texto de «${cut(before)}» a «${cut(this.value)}»`;
  }

  /** Resumen corto para el chip «Incluye»: «Elegir pl…» → «Empezar a…». */
  shortSummary(): string {
    const cut = (t: string) => (t.length > 16 ? `${t.slice(0, 15)}…` : t);
    const loc = this.info.kind === 'i18n' ? (this.info.locales ?? []).find((l) => this.changedIn(l.locale))?.locale ?? this.lang : '';
    return `«${cut(this.originalOf(loc) ?? '')}» → «${cut(this.values.get(loc) ?? '')}»`;
  }

  // --- Vista previa (reversible) ----------------------------------------------------------

  private applyPreview(): void {
    const node = ownTextNodes(this.el)[0];
    if (!node) return;
    if (!this.saved.some((s) => s.node === node)) this.saved.push({ node, value: node.nodeValue ?? '' });
    const shown = this.info.kind === 'dynamic' ? renderTemplate(this.value, this.info.variables ?? {}) : this.value;
    // En i18n solo se pinta el idioma activo de la página; otros idiomas no se ven.
    const pageLang = (this.el.ownerDocument.documentElement.lang || '').slice(0, 2).toLowerCase();
    if (this.info.kind === 'i18n' && pageLang && pageLang !== this.lang) return;
    node.nodeValue = shown;
  }

  revertPreview(): void {
    for (const s of this.saved) s.node.nodeValue = s.value;
    this.saved = [];
  }

  /** Deshace la vista previa y los valores editados. */
  reset(): void {
    this.revertPreview();
    this.values.clear();
    for (const l of this.info.locales ?? []) this.values.set(l.locale, l.before ?? '');
    if (this.info.kind !== 'i18n') this.values.set('', this.info.original);
  }

  // --- Propuesta -----------------------------------------------------------------------------

  /** null si no hay cambios o el texto dinámico perdió variables. */
  toProposal(targetSelector: string | null, taken?: ReadonlySet<string>): TextProposal | null {
    if (!this.changeCount || !this.valid) return null;
    const base = { id: localId('p', taken), targetSelector };
    const source = parseSrc(this.info.src);
    const src = source ? { source } : {};
    const info = this.info;
    if (info.kind === 'fixed') {
      return { ...base, kind: 'text_fixed', before: info.original, after: this.value, ...src };
    }
    if (info.kind === 'dynamic') {
      return {
        ...base,
        kind: 'text_dynamic',
        before: info.original,
        after: this.value,
        variables: info.variables ?? {},
        ...src,
      };
    }
    const locales = (info.locales ?? [])
      .filter((l) => this.changedIn(l.locale))
      .slice(0, LIMITS.i18nLocales)
      .map((l) => ({ locale: l.locale, before: l.before, after: this.values.get(l.locale) ?? '' }));
    const key = info.key ?? '';
    return {
      ...base,
      kind: 'text_i18n',
      key,
      library: info.library ?? null,
      uses: info.uses ?? null,
      scope: this.scope,
      newKey: this.scope === 'one' ? this.newKey : null,
      locales,
      ...src,
    };
  }
}
