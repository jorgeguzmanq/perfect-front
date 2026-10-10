/** Ejemplos tomados de SPEC.md §6.2, §6.3 y §6.5. */
export const specConfig = {
  version: 1,
  name: "Mi proyecto",
  command: "pnpm dev",
  url: "http://localhost:5173",
  defaultCollection: "inbox",
  resolvedCollection: "resolved",
  captureScreenshots: true,
  openBrowser: true,
};

export const specResolution = {
  resolvedAt: "2026-10-03T17:10:00.000Z",
  resolvedBy: "codex",
  summary: "Se aplicó ancho completo al botón en el breakpoint móvil.",
  filesChanged: ["src/components/BuyButton.tsx"],
  verification: ["pnpm test", "verificación visual a 390x844"],
  commit: null,
};

export function specComment(): Record<string, any> {
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
      selector: "main > section.pricing button.buy",
      selectorCandidates: ['[data-testid="buy-button"]', "main > section.pricing button.buy"],
      text: "Comprar",
      html: '<button class="buy">Comprar</button>',
      componentHint: null,
    },
    viewport: { width: 390, height: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 726 },
    elementRect: { x: 20, y: 601, width: 350, height: 44 },
    environment: { framework: "vite-react", browser: "Chrome", colorScheme: "dark" },
    attachments: ["attachments/pf_01K7A.png"],
    createdAt: "2026-10-03T15:30:00.000Z",
    updatedAt: "2026-10-03T15:30:00.000Z",
    resolution: null,
  };
}
