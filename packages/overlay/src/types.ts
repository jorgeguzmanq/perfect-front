import type { CreateCommentRequest, ScreenshotUploadSchema } from '@perfect-front/shared';
import type { GroupsPort } from './editor-ctx';
import type { OpenApi } from './open-code';

export type ScreenshotUpload = ReturnType<typeof ScreenshotUploadSchema.parse>;

/** IDLE solo existe en modo `passive` (capa activa que no intercepta la página). */
export type OverlayState = 'OFF' | 'IDLE' | 'SELECTING' | 'EDITING' | 'SAVING' | 'SAVED' | 'ERROR';

export interface SubmitResult {
  id: string;
  collection: string;
  route: string;
}

/** Captura de un nodo ya renderizada a una escala real (1×–4×). */
export interface CapturedShot {
  /** `nodo-button-cta@2x.png`: se usa como nombre del adjunto. */
  name: string;
  scale: 1 | 2 | 3 | 4;
  /** Tamaño real en píxeles del archivo. */
  width: number;
  height: number;
  bytes: number;
  mimeType: 'image/png' | 'image/webp';
  dataBase64: string;
}

/**
 * Tarjeta de resultado de la captura. Punto de enganche para Copiar/Descargar: añadir botones dentro de
 * `actions` (`.pf-ov-shot-actions`). `shots` refleja el resultado vigente (cambia al «Capturar de nuevo»).
 */
export interface ShotCard {
  readonly root: HTMLElement;
  readonly actions: HTMLElement;
  readonly shots: readonly CapturedShot[];
}

/** Lo que debe ofrecer el editor para recibir capturas («Adjuntar N»). Se detecta en tiempo de ejecución. */
export interface ShotAttachPort {
  /** Suma las capturas como adjuntos (source 'capture', con su nombre). `error` si alguna no entra. */
  attachShots(shots: readonly CapturedShot[]): { added: number; error?: string };
}

export interface OverlayOptions {
  /** Se llama cada vez que la tarjeta de resultado de captura muestra capturas nuevas. */
  onShotCard?(card: ShotCard): void;
  onSubmit(req: CreateCommentRequest): Promise<SubmitResult>;
  onRequestCapture?(): Promise<ScreenshotUpload>;
  onStateChange?(s: OverlayState): void;
  /** Tras guardar con éxito (p. ej. para refrescar los pines). */
  onSaved?(res: SubmitResult): void;
  /**
   * Modo página: `enable()` deja la capa en IDLE y NO intercepta clics normales.
   * Alt+clic (o el modo selección con Ctrl/Cmd+Mayús+C) inicia un comentario.
   * Con la captura se ofrece la casilla «Incluir captura» en vez del botón.
   */
  passive?: boolean;
  /** Grupos de lectura y cola (pestaña «Cola» del editor). Sin esto la pestaña no ofrece grupos. */
  groups?: GroupsPort | null;
  /** «Abrir en el código» (↗ de la cabecera del editor). Sin esto el botón no se muestra. */
  openCode?: OpenApi | null;
  document?: Document;
}

export interface OverlayHandle {
  enable(): void;
  disable(): void;
  destroy(): void;
  /** Modo pasivo: alterna el modo selección (clic normal = comentar). */
  toggleSelecting(): void;
  /** Abre la selección con un grupo preseleccionado (el siguiente comentario va a su cola). */
  startInGroup(groupId: string): void;
  /** Abre la captura de los nodos seleccionados (Alt+Mayús+S). false si no hay nodo o la capa está apagada. */
  captureSelectedNodes(): boolean;
  readonly state: OverlayState;
}
