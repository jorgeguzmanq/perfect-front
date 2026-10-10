import { captureViewport } from './capture';
import { createLauncher, type LauncherHandle } from './launcher';
import { onNavigate } from './navigation';
import { createOverlay } from './overlay';
import { createPins, type PinComment, type PinsHandle } from './pins';
import type { OverlayHandle, OverlayState, SubmitResult } from './types';
import type { CreateCommentRequest } from '@perfect-front/shared';

export const VERSION = '0.1.0';
export const LAYER_KEY = 'pf:layer';
export const HINT_KEY = 'pf:hint-seen';

export interface PfApi {
  readonly version: string;
  /** Activa la capa (pines, contador y comentario con Alt+clic) y lo recuerda en localStorage. */
  enable(): void;
  /** Apaga la capa: sin pines ni captura de clics. Se recuerda en localStorage. */
  disable(): void;
  isEnabled(): boolean;
  readonly state: OverlayState;
  /** Desmonta todo y elimina window.__pf (no cambia la preferencia guardada). */
  destroy(): void;
}

declare global {
  interface Window {
    __pf?: PfApi;
  }
}

export interface BootOptions {
  token: string;
  /** Prefijo de la API en el mismo origen, p. ej. '/__pf'. */
  base: string;
  window?: Window;
  fetch?: typeof fetch;
}

const readPref = (win: Window, key = LAYER_KEY): string | null => {
  try {
    return win.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writePref = (win: Window, value: string, key = LAYER_KEY) => {
  try {
    win.localStorage.setItem(key, value);
  } catch {
    /* almacenamiento bloqueado: la preferencia solo vale para esta carga */
  }
};

interface ApiErrorBody {
  ok?: boolean;
  error?: { code?: string; message?: string };
}

/** Monta la capa en la página y expone window.__pf. Idempotente por ventana. */
export function bootPage(opts: BootOptions): PfApi {
  const win = opts.window ?? window;
  if (win.__pf) return win.__pf;

  const base = opts.base.replace(/\/+$/, '');
  const doc = win.document;
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const headers = (extra: Record<string, string> = {}) => ({ 'X-PF-Token': opts.token, ...extra });

  const postComment = async (req: CreateCommentRequest): Promise<SubmitResult> => {
    const res = await doFetch(`${base}/comment`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(req),
    });
    const body = await res
      .json()
      .then((j: unknown) => j as (ApiErrorBody & { data?: SubmitResult }) | null)
      .catch(() => null); // respuesta no JSON
    if (!res.ok || !body || body.ok === false || !body.data) {
      throw new Error(body?.error?.message ?? `El servidor respondió ${res.status}.`);
    }
    return body.data;
  };

  const loadComments = async (): Promise<PinComment[]> => {
    const res = await doFetch(`${base}/comments`, { headers: headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean; comments?: unknown };
    if (!body || body.ok === false || !Array.isArray(body.comments)) throw new Error('respuesta inválida');
    return body.comments.filter(
      (c): c is PinComment =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as PinComment).id === 'string' &&
        typeof (c as PinComment).comment === 'string' &&
        typeof (c as PinComment).location?.route === 'string',
    );
  };

  // El lanzador solo vive en la ventana superior; en iframes la capa funciona con Alt+clic.
  const isTop = (() => {
    try {
      return win.top === win;
    } catch {
      return false;
    }
  })();
  let launcher: LauncherHandle | null = null;

  let overlay: OverlayHandle | null = null;
  let pins: PinsHandle | null = null;
  let stopNav: (() => void) | null = null;
  let enabled = readPref(win) !== 'off';
  let gone = false;
  let readyCleanup: (() => void) | null = null;

  const mountLayer = () => {
    if (gone || overlay) return;
    overlay = createOverlay({
      document: doc,
      passive: true,
      onSubmit: postComment,
      onStateChange: (st) => launcher?.setSelecting(st === 'SELECTING'),
      onRequestCapture: async () => {
        launcher?.setHidden(true);
        try {
          return await captureViewport(win);
        } finally {
          launcher?.setHidden(false);
        }
      },
      onSaved: () => void pins?.refresh(),
    });
    overlay.enable();
    pins = createPins({
      document: doc,
      loadComments,
      onStats: (st) => launcher?.setStats({ total: st.total, here: st.here, route: st.route }),
    });
    void pins.refresh();
    stopNav = onNavigate(win, () => {
      pins?.relocate();
      void pins?.refresh();
    });
  };

  const unmountLayer = () => {
    readyCleanup?.();
    readyCleanup = null;
    stopNav?.();
    stopNav = null;
    pins?.destroy();
    pins = null;
    overlay?.destroy();
    overlay = null;
    launcher?.setSelecting(false);
  };

  /** Los pines necesitan el body; si el script corre en <head>, se espera a DOMContentLoaded. */
  const mountWhenReady = () => {
    if (doc.readyState !== 'loading') return mountLayer();
    const onReady = () => {
      readyCleanup = null;
      if (enabled) mountLayer();
    };
    doc.addEventListener('DOMContentLoaded', onReady, { once: true });
    readyCleanup = () => doc.removeEventListener('DOMContentLoaded', onReady);
  };

  const api: PfApi = {
    version: VERSION,
    enable() {
      if (gone) return;
      enabled = true;
      writePref(win, 'on');
      launcher?.setLayerOn(true);
      if (!overlay && !readyCleanup) mountWhenReady();
    },
    disable() {
      if (gone) return;
      enabled = false;
      writePref(win, 'off');
      unmountLayer();
      launcher?.setLayerOn(false);
    },
    isEnabled: () => enabled,
    get state(): OverlayState {
      return overlay?.state ?? 'OFF';
    },
    destroy() {
      if (gone) return;
      gone = true;
      unmountLayer();
      launcher?.destroy();
      launcher = null;
      if (win.__pf === api) delete win.__pf;
    },
  };
  win.__pf = api;
  if (isTop) {
    launcher = createLauncher({
      document: doc,
      onToggleSelect: () => overlay?.toggleSelecting(),
      onHide: () => api.disable(),
      onShow: () => api.enable(),
    });
    launcher.setLayerOn(enabled);
    if (enabled && readPref(win, HINT_KEY) !== '1') {
      launcher.showHint();
      writePref(win, '1', HINT_KEY);
    }
  }
  if (enabled) mountWhenReady();
  return api;
}
