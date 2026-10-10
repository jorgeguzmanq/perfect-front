import type { VisualComment } from "@perfect-front/shared";

/** Comentario valido segun shared (cast: los tipos brand no se construyen a mano en pruebas). */
export function makeComment(over: Record<string, unknown> = {}, loc: Record<string, unknown> = {}): VisualComment {
  return {
    version: 1,
    id: "pf_01K7A",
    status: "pending",
    collection: "inbox",
    scope: "element",
    comment: "Este botón debe ocupar todo el ancho en móvil.",
    project: { name: "Mi proyecto", relativeRoot: "." },
    location: {
      url: "http://localhost:5173/pricing",
      route: "/pricing",
      title: "Precios",
      selector: "main button.buy",
      selectorCandidates: ['[data-testid="buy-button"]', "main button.buy"],
      text: "Comprar",
      html: '<button class="buy">Comprar</button>',
      componentHint: null,
      ...loc,
    },
    viewport: { width: 390, height: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    elementRect: { x: 20, y: 601, width: 350, height: 44 },
    environment: { framework: "vite-react", browser: "Chrome", colorScheme: "dark" },
    attachments: [],
    createdAt: "2026-10-03T15:30:00.000Z",
    updatedAt: "2026-10-03T15:30:00.000Z",
    resolution: null,
    ...over,
  } as unknown as VisualComment;
}
