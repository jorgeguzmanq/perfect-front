# Overlay

Capa de comentarios que el proxy inyecta en la página (mundo principal, mismo origen que la API `/__pf/*`):

```html
<script src="/__pf/overlay.js" data-pf-token="…" data-pf-base="/__pf"></script>
```

- `src/boot.ts`: entrada IIFE. `src/boot-core.ts`: `bootPage()` (testeable) y `window.__pf = { version, enable, disable, isEnabled, state, destroy }`.
- Capa activa por defecto: un clic normal NO se intercepta. **Alt+clic** abre el comentario; **Ctrl/Cmd+Mayús+C** alterna el modo selección (ahí el clic normal comenta; Esc sale). `localStorage['pf:layer']==='off'` arranca apagada.
- `src/build.ts` (solo Node): `buildOverlayBundle()` empaqueta `boot.ts` con esbuild; `pnpm build` escribe `dist/overlay.js`.
- `createOverlay({ passive: true })` es el modo página; sin `passive` conserva el modo selección que intercepta clics.
- `data-pf-src="archivo:línea"` (plugin de build, aún no existe) se muestra en la cabecera cuando está presente.

## Estilos

Solo variables `--pf-*` y clases `.pf-*` de `@perfect-front/design-tokens` (ver su `CONSUMERS.md`).
