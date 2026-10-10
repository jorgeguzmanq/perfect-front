# @perfect-front/design-tokens

Fuente única de verdad de estilos para dashboard, popup de la extensión y overlay (Shadow DOM).

## Archivos
- `src/tokens.css`: variables `--pf-*` en `:root` y `:host`; tema claro/oscuro por `prefers-color-scheme` o `[data-theme="light|dark"]`; motion reducido.
- `src/base.css`: reset acotado a `.pf-root` y primitivas `.pf-btn`, `.pf-input`, `.pf-chip`.
- `src/tokens.ts`: mismos valores tipados + `getTokensCss()`.
- `src/tailwind-theme.css`: `@theme inline` opcional para Tailwind 4.

## Cómo lo consume cada superficie
- **Dashboard (Vite + React):** `import '@perfect-front/design-tokens/tokens.css'` y `.../base.css` en el entry; opcional `tailwind-theme.css` tras `@import "tailwindcss"`. Envolver la app en `<div class="pf-root">` (o poner `pf-root` en `body`).
- **Popup MV3:** mismo import en el entry del popup (Vite lo empaqueta; MV3 no permite CSS remoto). `<body class="pf-root">`.
- **Overlay / Shadow DOM:** el CSS de la página no entra al Shadow Root, así que se inyecta como texto: `import tokens from '@perfect-front/design-tokens/tokens.css?inline'` y `base.css?inline` (o `getTokensCss()`), y se agrega un `<style>` o `adoptedStyleSheets` en el root. El contenedor interno lleva `class="pf-root"`. Tema forzado: `data-theme` en el elemento host.

## Reglas
1. Nunca hardcodear colores, espaciados, radios, sombras, z-index ni duraciones fuera de tokens: usar `var(--pf-*)`.
2. Valor nuevo = token nuevo en `tokens.css` Y `tokens.ts` (y en `tailwind-theme.css` si el dashboard lo necesita).
3. Clases propias siempre con prefijo `.pf-`; no estilizar selectores de elemento globales.
4. Respetar foco visible y `prefers-reduced-motion` (usar `--pf-duration-*`).
5. Estados de comentario: solo los cinco definidos (`pending`, `in_progress`, `resolved`, `ignored`, `archived`).
