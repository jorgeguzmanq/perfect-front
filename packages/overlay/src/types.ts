import type { CreateCommentRequest, ScreenshotUploadSchema } from '@perfect-front/shared';

export type ScreenshotUpload = ReturnType<typeof ScreenshotUploadSchema.parse>;

/** IDLE solo existe en modo `passive` (capa activa que no intercepta la página). */
export type OverlayState = 'OFF' | 'IDLE' | 'SELECTING' | 'EDITING' | 'SAVING' | 'SAVED' | 'ERROR';

export interface SubmitResult {
  id: string;
  collection: string;
  route: string;
}

export interface OverlayOptions {
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
  document?: Document;
}

export interface OverlayHandle {
  enable(): void;
  disable(): void;
  destroy(): void;
  /** Modo pasivo: alterna el modo selección (clic normal = comentar). */
  toggleSelecting(): void;
  readonly state: OverlayState;
}
