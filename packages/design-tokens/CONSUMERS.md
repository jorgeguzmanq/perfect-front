# Contrato para consumidores

Paquete: `@perfect-front/design-tokens` (añadir como dependencia `workspace:*`).

## Imports exactos
```ts
import '@perfect-front/design-tokens/tokens.css';
import '@perfect-front/design-tokens/base.css';
import '@perfect-front/design-tokens/tailwind-theme.css'; // solo dashboard con Tailwind 4, tras @import "tailwindcss"
import { getTokensCss, statusChipClass, commentStatuses, type CommentStatus } from '@perfect-front/design-tokens';
// Overlay (Vite):
import tokensCss from '@perfect-front/design-tokens/tokens.css?inline';
import baseCss from '@perfect-front/design-tokens/base.css?inline';
```

## Overlay (Shadow Root)
```ts
const style = document.createElement('style');
style.textContent = tokensCss + '\n' + baseCss; // o getTokensCss() + baseCss
shadowRoot.append(style);
const root = document.createElement('div');
root.className = 'pf-root';
shadowRoot.append(root);
// tema forzado: host.setAttribute('data-theme', 'dark' | 'light')
```
Capa superior: `z-index: var(--pf-z-overlay)`. Cuando el modo esté apagado, el host no debe capturar eventos (`pointer-events: none`).

## Clases
- `.pf-root` (contenedor raíz; aplica fuente, color, fondo y box-sizing)
- `.pf-btn`, `.pf-btn--primary`, `.pf-btn--danger`
- `.pf-input` (input/textarea/select)
- `.pf-chip` + `.pf-chip--pending | --in_progress | --resolved | --ignored | --archived` (o `statusChipClass(status)`)
- `.pf-focusable` (añade el anillo de foco a elementos propios)

## Variables (todas `--pf-`)
- Color: `color-bg|surface|surface-raised|border|text|text-muted|accent|accent-hover|accent-fg|danger|focus|overlay-backdrop`
- Estado: `status-{pending|in-progress|resolved|ignored|archived}-{fg|bg}` (guion en la variable, guion bajo en la clase)
- Tipografía: `font-sans|mono`, `font-size-xs|sm|md|lg|xl`, `font-weight-regular|medium|bold`, `line-height-tight|base`
- Espaciado: `space-1..7`; radios: `radius-sm|md|lg|full`; sombras: `shadow-sm|md|lg`
- z-index: `z-base|dropdown|modal|overlay`
- Motion: `duration-fast|base|slow`, `ease-standard`
- Foco: `focus-ring`, `focus-ring-width`, `focus-ring-offset`; `control-height`

## Tailwind (opcional)
Utilidades de `tailwind-theme.css`: `bg-pf-bg|surface|surface-raised|accent`, `text-pf-text|muted|accent-fg`, `border-pf-border`, `text-pf-pending` / `bg-pf-pending-bg` (igual para in-progress, resolved, ignored, archived), `font-pf-sans|mono`, `rounded-pf-sm|md|lg`, `shadow-pf-sm|md|lg`, `text-pf-xs|sm|md|lg|xl`, `ease-pf`.
