import { captureViewport } from './capture';
import { imageToBlob } from './attachments';
import { mountShotActions } from './clipboard';
import { createDrawer, type DrawerHandle } from './drawer';
import type { GroupsPort } from './editor-ctx';
import type { GroupsApi, QueueComment } from './groups';
import { createLauncher, type LauncherHandle } from './launcher';
import { onNavigate } from './navigation';
import { createOverlay } from './overlay';
import { createPins, type PinComment, type PinsHandle } from './pins';
import type { CapturedShot, OverlayHandle, OverlayState, SubmitResult } from './types';
import type {
  CommentGroupRef,
  CreateCommentRequest,
  CreateGroupRequest,
  ReadingGroup,
  ReorderGroupRequest,
  UpdateGroupRequest,
} from '@perfect-front/shared';

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

  /** Llamada REST JSON (mismo origen, con el token). Devuelve el cuerpo ya validado como `ok`. */
  const call = async <T extends object>(path: string, method: string, payload?: unknown): Promise<T> => {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: headers(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await res
      .json()
      .then((j: unknown) => j as (ApiErrorBody & T) | null)
      .catch(() => null);
    if (!res.ok || !body || body.ok === false) {
      throw new Error(body?.error?.message ?? `El servidor respondió ${res.status}.`);
    }
    return body;
  };

  // Grupos de lectura: rutas REST `/groups` del local-server (el proxy las reenvía con el proyecto ya resuelto).
  const gid = (id: string) => encodeURIComponent(id);
  const groupsApi: GroupsApi = {
    listGroups: async () => (await call<{ groups: ReadingGroup[] }>('/groups', 'GET')).groups ?? [],
    createGroup: async (req: CreateGroupRequest) => (await call<{ group: ReadingGroup }>('/groups', 'POST', req)).group,
    updateGroup: async (id: string, req: UpdateGroupRequest) =>
      (await call<{ group: ReadingGroup }>(`/groups/${gid(id)}`, 'PATCH', req)).group,
    reorderGroup: async (id: string, req: ReorderGroupRequest) => {
      await call(`/groups/${gid(id)}/reorder`, 'POST', req);
    },
    setCommentGroup: async (commentId: string, ref: CommentGroupRef | null) => {
      await call(`/comments/${gid(commentId)}`, 'PATCH', { group: ref });
    },
  };

  // Caché sincrónica que lee el editor (`GroupsPort`); se renueva al cargar comentarios/grupos.
  let groupsCache: ReadingGroup[] = [];
  let commentsCache: QueueComment[] = [];
  const groupsPort: GroupsPort = { api: groupsApi, groups: () => groupsCache, comments: () => commentsCache };

  const refreshGroups = async () => {
    try {
      groupsCache = await groupsApi.listGroups();
    } catch {
      /* sin grupos disponibles: el editor y el cajón siguen funcionando sin cola */
    }
  };

  const loadComments = async (): Promise<PinComment[]> => {
    const res = await doFetch(`${base}/comments`, { headers: headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean; comments?: unknown };
    if (!body || body.ok === false || !Array.isArray(body.comments)) throw new Error('respuesta inválida');
    const list = body.comments.filter(
      (c): c is PinComment =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as PinComment).id === 'string' &&
        typeof (c as PinComment).comment === 'string' &&
        typeof (c as PinComment).location?.route === 'string',
    );
    commentsCache = list; // incluye `group` cuando el servidor lo envía
    return list;
  };

  /** Cajón de comentarios (cola y grupos): vive en el Shadow Root del lanzador. */
  let drawer: DrawerHandle | null = null;
  const route = () => doc.location.pathname || '/';
  const openDrawer = () => {
    if (!launcher || gone) return;
    drawer ??= createDrawer({
      doc,
      layer: launcher.layer,
      load: async () => {
        const [comments] = await Promise.all([loadComments(), refreshGroups()]);
        return { comments, groups: groupsCache };
      },
      api: groupsApi,
      route,
      onGoto: (c) => {
        // Solo desplaza la vista hasta el nodo; no modifica la página.
        const sels = [c.location.selector].filter((x): x is string => !!x);
        for (const s of sels) {
          try {
            const el = doc.querySelector(s);
            if (el) return el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } catch {
            /* selector inválido */
          }
        }
      },
      onAddToGroup: (groupId) => {
        if (!overlay) return;
        drawer?.close();
        overlay.startInGroup(groupId);
      },
      announce: (m) => launcher?.showHint(m),
    });
    drawer.toggle();
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
  const shotOffs: Array<() => void> = [];

  const mountLayer = () => {
    if (gone || overlay) return;
    overlay = createOverlay({
      document: doc,
      passive: true,
      onSubmit: postComment,
      groups: groupsPort,
      onStateChange: (st) => {
        launcher?.setSelecting(st === 'SELECTING');
        if (st === 'EDITING') void refreshGroups(); // la pestaña «Cola» lee la caché de grupos
      },
      onShotCard: (card) => {
        // Copiar/Descargar por cada captura; se liberan al cambiar el resultado o al cerrar la capa.
        const offs = shotOffs.splice(0);
        for (const f of offs) f();
        card.actions.textContent = '';
        for (const s of card.shots as readonly CapturedShot[]) {
          shotOffs.push(
            mountShotActions(card.actions, {
              getBlob: () => imageToBlob(s),
              name: s.name,
              onResult: (m) => launcher?.showHint(m),
            }),
          );
        }
      },
      // Sin ocultar nada: captureViewport excluye los nodos propios con isPfNode (no hay parpadeo).
      onRequestCapture: () => captureViewport(win),
      onSaved: () => {
        void pins?.refresh();
        void drawer?.refresh();
      },
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
    for (const f of shotOffs.splice(0)) f();
    drawer?.close();
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
      drawer?.destroy();
      drawer = null;
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
      onOpenComments: openDrawer,
      onCaptureNode: () => void overlay?.captureSelectedNodes(),
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
