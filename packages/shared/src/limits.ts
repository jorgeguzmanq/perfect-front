/** Límites de tamaño (SPEC §15.10). Compartidos por comentario v1 y v2. */
export const LIMITS = {
  comment: 10_000,
  html: 20_000,
  text: 2_000,
  selector: 1_000,
  selectorCandidates: 20,
  // --- v2 ---
  /** Secciones por comentario. */
  sections: 20,
  sectionTitle: 120,
  sectionText: 5_000,
  /** Adjuntos totales por comentario (suma de todas las secciones y sueltos). */
  attachments: 20,
  attachmentName: 200,
  /** Elementos adicionales de una multiselección (además del principal en `location`). */
  extraTargets: 19,
  extraTargetHtml: 4_000,
  proposals: 50,
  /** Texto antes/después de una propuesta de contenido. */
  proposalText: 2_000,
  styleChanges: 50,
  styleValue: 500,
  i18nLocales: 12,
  textVariables: 20,
  groupName: 120,
  groupNote: 5_000,
  /** Comentarios por grupo en una reordenación. */
  groupItems: 200,
  /** Suma de caracteres base64 de todas las subidas de una request (cabe en el body de 14 MB). */
  uploadsBase64: 13_000_000,
} as const;
