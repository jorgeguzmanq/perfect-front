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

## Estado v2 (prototipo)

La capa v2 solo existe como prototipo estático en `.design/overlay-layer.html` (ver `.design/v2-inventory.md`). Según ese inventario:

- Los `data-act` no tienen manejador y no hay `keydown`, `paste`, `drop` ni carga de imágenes. Atajos, arrastre, pegado, guardado y menú de copiar solo se ven como estados.
- Las pestañas Contenido, Estilos, Estructura y Cola muestran la UI de propuestas y grupos, pero no ejecutan cambios.
- El límite de 20 adjuntos aparece solo en texto; el prototipo no tiene contador ni bloqueo.
- El prototipo muestra GIF como formato admitido. El esquema de `shared` admite solo PNG, JPEG y WebP.

Los contratos que enviaría esta capa (secciones, adjuntos, `extraTargets`, `proposals`, `group`) están en `packages/shared/README.md`. Este README no documenta código de `src/` de v2.
