import type { ReadingGroup } from '@perfect-front/shared';
import type { Attachments } from './attachments';
import type { ContentEditor } from './content-edit';
import type { GroupBinding, GroupsApi, QueueComment } from './groups';
import type { ReorderModel } from './reorder';
import type { Sections } from './sections';
import type { Selection } from './selection';
import type { StyleEditor } from './style-edit';

/**
 * Vistas de la pila del editor: `comment` es la base (siempre debajo); el resto se abre encima desde un chip
 * «Proponer», desde «Incluye» o desde el menú «⋯», y se cierra con «‹ Comentar» o Esc.
 */
export type PanelView = 'comment' | 'content' | 'styles' | 'struct' | 'layers' | 'group';
export type Scope = 'element' | 'view';
export type Region = 'head' | 'tray' | 'strip' | 'nav' | 'sub' | 'body' | 'inc' | 'foot';

/** Título de cada subvista (cabecera «‹ Comentar · Título»). */
export const VIEW_TITLE: Record<PanelView, string> = {
  comment: 'Comentar',
  content: 'Texto',
  styles: 'Estilos',
  struct: 'Orden',
  layers: 'Capas',
  group: 'Grupo',
};

/** Lo que el editor edita sobre un nodo concreto (sobrevive a la navegación: las propuestas ya hechas se conservan). */
export interface NodeEdits {
  el: Element;
  /** Selector propio para `targetSelector` cuando el nodo no es el principal. */
  selector: string;
  content?: ContentEditor | null;
  /** undefined = aún no evaluado; null = el nodo no tiene texto propio. */
  contentChecked?: boolean;
  style?: StyleEditor;
  reorder?: ReorderModel;
}

export interface GroupsPort {
  api: GroupsApi;
  groups(): ReadingGroup[];
  comments(): QueueComment[];
}

/** Estado y servicios compartidos entre el controlador del editor y los renderizadores de pestañas. */
export interface EditorCtx {
  doc: Document;
  sel: Selection;
  scope: Scope;
  /** Vista abierta (solo lectura: se cambia con `setView`). */
  readonly view: PanelView;
  draft: string;
  busy: boolean;
  /** Error de guardado/validación del comentario. */
  error: string;
  /** Error de imagen. */
  imgError: string;
  dragging: boolean;
  lang: string;
  fndOpen: boolean;
  /** Vista Estilos: «Lista» (filas por propiedad) o «Visual» (controles por sección). */
  styleMode: 'list' | 'visual';
  /** Grupos de la lista de Estilos abiertos/cerrados a mano (sin entrada = por defecto: con cambios o el primero). */
  styleOpen: Record<string, boolean>;
  att: Attachments;
  sections: Sections;
  groupsPort: GroupsPort | null;
  binding: GroupBinding | null;
  canCapture: boolean;

  /** Ediciones del nodo enfocado (se crean al pedirlas). */
  edits(): NodeEdits | null;
  allEdits(): NodeEdits[];
  /** Comentario autogenerado por las propuestas actuales ("" si no hay). */
  autoText(): string;
  /** El texto generado ya se copió al borrador para editarlo: no se vuelve a anteponer/añadir al guardar. */
  autoMerged: boolean;
  rerender(...regions: Region[]): void;
  /** Abre una vista (o vuelve a la base con 'comment'). Mueve el foco a «‹ Comentar» / a la nota. */
  setView(v: PanelView): void;
  /** ¿Aplica la vista al estado actual del mapa (texto propio, 1 nodo con hermanos, grupos…)? */
  available(v: PanelView): boolean;
  announce(msg: string): void;
  /** Registra un listener con limpieza al desmontar/redibujar. */
  on(target: EventTarget, type: string, fn: (e: Event) => void): void;
  addImages(files: File[], source: 'paste' | 'drop' | 'open', sectionId: string | null): Promise<void>;
  captureImage(): Promise<void>;
  /** «Capturar ▾ → Nodo seleccionado»: abre la captura con escalas (null = no disponible). */
  captureNodes: ((sectionId: string | null) => void) | null;
  navigate(dir: 'parent' | 'child' | 'prev' | 'next'): void;
  retarget(el: Element): void;
  focusNode(el: Element | null): void;
  /** Sumar/quitar (additive) o reemplazar un nodo de la selección, como un clic en la página. */
  pick(el: Element, additive: boolean): void;
  /** Resalta un nodo de la página sin seleccionarlo (null = quitar). Solo dibuja en el overlay. */
  hover(el: Element | null): void;
  save(): void;
}
