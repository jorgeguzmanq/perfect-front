import {
  COMMENT_VERSION,
  composeWithAuto,
  CreateCommentRequestSchema,
  type CommentGroupRef,
  type CommentProposal,
  type CreateCommentRequest,
} from '@perfect-front/shared';
import type { Attachments } from './attachments';
import { buildRequest } from './context';
import type { Sections } from './sections';
import { composeComment } from './sections';
import type { Selection } from './selection';

export interface DraftV2 {
  doc: Document;
  scope: 'element' | 'view';
  selection: Selection;
  /** Texto de la pestaña Comentar. */
  main: string;
  /** Texto de reserva si `main` está vacío (p. ej. «Cambiar texto de … a …»). */
  fallbackText?: string | null;
  /** Comentario autogenerado por las propuestas (SPEC §6.3): se antepone la nota si hay; solo, si no la hay. */
  autoText?: string | null;
  sections: Sections;
  attachments: Attachments;
  proposals: readonly CommentProposal[];
  group: CommentGroupRef | null;
}

export type BuildResult = { ok: true; request: CreateCommentRequest } | { ok: false; error: string };

/**
 * `targetSelector` de una propuesta para el nodo dado: null si es el principal (primer nodo), su selector si
 * es otro (obligatorio en scope view; allí no hay propuestas porque las pestañas están apagadas).
 */
export function targetSelectorFor(selection: Selection, nodeIndex: number): string | null {
  if (nodeIndex <= 0) return null;
  return selection.nodes[nodeIndex]?.snap.selector ?? null;
}

/** ¿Hay algo que guardar? (texto, secciones con texto, imágenes o propuestas). */
export function hasContent(d: Pick<DraftV2, 'main' | 'sections' | 'attachments' | 'proposals' | 'fallbackText' | 'autoText'>): boolean {
  return (
    !!d.main.trim() ||
    !!d.fallbackText ||
    !!d.autoText ||
    d.sections.items.some((s) => s.text.trim()) ||
    d.attachments.count > 0 ||
    d.proposals.length > 0
  );
}

/** Construye y valida el CreateCommentRequest v2. El error es un mensaje listo para mostrar. */
export function buildRequestV2(d: DraftV2): BuildResult {
  const comment = composeWithAuto(composeComment(d.main, d.sections.items), d.autoText ?? '') || (d.fallbackText ?? '').trim();
  if (!comment) return { ok: false, error: 'Escribe un comentario antes de guardar.' };

  const element = d.scope === 'element' ? d.selection.nodes[0] ?? null : null;
  const raw = buildRequest(d.doc, comment, element ? element.snap : null) as Record<string, unknown>;

  const uploads = d.attachments.toUploads();
  const withImages = new Set(uploads.map((u) => u.sectionId).filter((s): s is string => s !== null));
  raw.version = COMMENT_VERSION;
  raw.sections = d.sections.toRequest(withImages);
  raw.uploads = uploads;
  raw.extraTargets = element ? d.selection.toExtraTargets() : [];
  raw.proposals = [...d.proposals];
  raw.group = d.group;

  const parsed = CreateCommentRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `El comentario no es válido: ${issue?.message ?? 'datos incorrectos'}.` };
  }
  return { ok: true, request: parsed.data };
}
