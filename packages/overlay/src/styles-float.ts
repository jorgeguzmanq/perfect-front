/**
 * CSS del Comment Deck para la capa 01 «Lanzador» (dock, menú, aviso) y la capa 13 «Flotantes» (panel movible/anclado/
 * minimizado, pines con popover) + el ORDEN DE APILADO, definido aquí y solo aquí. Clases `pf-dk-fl-*` y los selectores
 * ya existentes del lanzador/pines (los tests y las capas los usan); sin fuentes ni red. Va después de `deckCss`.
 *
 * Orden de apilado (de abajo arriba). Cada host del overlay es `position: fixed` (contexto propio), así que el
 * orden entre hosts lo fija el z-index del host y, dentro de uno, el z-index de sus piezas:
 *   1. marcas en la página (resaltado, flecha, inserción)          → host del overlay, nivel --pf-zf-marks
 *   2. pines y su popover                                          → host de pines (debajo del host del overlay)
 *   3. panel del editor (y su píldora, zonas y borde)              → host del overlay, nivel --pf-zf-panel
 *   4. barra de selección                                          → host del overlay, nivel --pf-zf-bar
 *   5. menú y avisos del lanzador, siempre encima                  → host del lanzador (el más alto)
 * Límite conocido: marcas y panel comparten host, así que los pines quedan entre el host del overlay y la página;
 * las marcas son translúcidas, por lo que los pines siguen visibles debajo de ellas.
 */
export const floatDeckCss = `
:host {
  --pf-zf-marks: 1;
  --pf-zf-panel: 2;
  --pf-zf-bar: 3;
  --pf-zf-pin: 1;
  --pf-zf-pop: 2;
  --pf-zf-ln-dock: 1;
  --pf-zf-ln-float: 2;
}
:host([data-perfect-front-pins]) { z-index: var(--pf-z-overlay); }
:host([data-perfect-front-overlay]) { z-index: calc(var(--pf-z-overlay) + 1); }
:host([data-perfect-front-launcher]) { z-index: calc(var(--pf-z-overlay) + 2); }
.pf-ov-highlight, .pf-ov-insert, .pf-ov-tip { z-index: var(--pf-zf-marks); }
.pf-ov-panel, .pf-dk-fl-pill, .pf-dk-fl-edge, .pf-dk-fl-zone, .pf-dk-fl-hint { z-index: var(--pf-zf-panel); }
.pf-ov-toolbar { z-index: var(--pf-zf-bar); }
.pf-pins-layer .pf-pin { z-index: var(--pf-zf-pin); }
.pf-pins-layer .pf-dk-fl-pop { z-index: var(--pf-zf-pop); }
.pf-ln > .pf-ln-group { z-index: var(--pf-zf-ln-dock); }
.pf-ln > .pf-ln-menu, .pf-ln > .pf-ln-toast, .pf-ln > .pf-ln-tab { z-index: var(--pf-zf-ln-float); }

/* ---------- 01 Lanzador: dock ---------- */
.pf-ln > .pf-ln-group.pf-dk-dock {
  right: 24px;
  bottom: 22px;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
  border: 0;
  border-radius: 14px;
  overflow: visible;
  background: var(--pf-dk-chassis);
  color: var(--pf-dk-ink);
  font-family: var(--pf-dk-lab);
  box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 14px 24px rgba(0, 0, 0, .55);
}
.pf-dk-dock .pf-ln-grip { padding: 0 2px; color: #6b6b74; font-size: 14px; letter-spacing: 0; cursor: grab; user-select: none; }
.pf-dk-dock .pf-ln-main.pf-dk-key { height: 40px; min-height: 40px; padding: 0 14px; }
.pf-dk-dock .pf-ln-more.pf-dk-key { height: 40px; min-height: 40px; padding: 0; border-inline-start: 0; }
.pf-dk-dock .pf-ln-main.pf-dk-key--hot { background: var(--pf-dk-solid); color: #fff; box-shadow: none; }
.pf-dk-dock .pf-ln-main.pf-dk-key--hot:hover { background: var(--pf-dk-solid-hover); }
.pf-dk-dock .pf-ln-main.pf-dk-key--lit { background: var(--pf-dk-lit-bg); color: var(--pf-dk-lit-fg); box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-dock .pf-ln-main.pf-dk-key--lit:hover { background: var(--pf-dk-lit-bg); }
.pf-dk-dock .pf-ln-badge.pf-dk-cnt { min-width: 0; padding: 0 7px; border-radius: var(--pf-dk-r); background: rgba(0, 0, 0, .28); color: #fff; font: 500 11px/18px var(--pf-dk-mono); }
.pf-dk-dock .pf-ln-main.pf-dk-key--lit .pf-ln-badge.pf-dk-cnt { background: #2e2a57; color: var(--pf-dk-lit-fg); }
.pf-dk-dock .pf-ln-main:focus-visible, .pf-dk-dock .pf-ln-more:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: 2px; }

/* Menú, aviso y pestaña «Mostrar capa» */
.pf-ln > .pf-ln-menu.pf-dk-unit {
  right: 24px;
  bottom: 96px;
  inline-size: 300px;
  max-inline-size: calc(100vw - 32px);
  min-inline-size: 0;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  background: var(--pf-dk-chassis);
}
.pf-ln-stats { margin-bottom: 8px; }
.pf-ln-stat { flex: 1; padding: 6px 0; text-align: center; }
.pf-ln-item.pf-dk-key { justify-content: flex-start; align-self: stretch; height: 36px; padding: 0 12px; }
.pf-ln-item.pf-dk-key:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: -2px; }
.pf-ln-info.pf-dk-ts { padding: 8px 4px 0; overflow-wrap: anywhere; }
.pf-ln > .pf-ln-toast.pf-dk-lcd {
  right: 24px;
  bottom: 96px;
  inline-size: 340px;
  max-inline-size: calc(100vw - 32px);
  padding: 8px 10px;
  background: var(--pf-dk-chassis);
  box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 10px 24px rgba(0, 0, 0, .5);
}
.pf-ln-toast .pf-ln-toasta { flex: none; }
.pf-ln-toast .pf-ln-toastx.pf-dk-key { padding: 0; color: var(--pf-dk-ink2); }
.pf-ln > .pf-ln-tab.pf-dk-key { right: 24px; bottom: 8px; height: 30px; padding: 0 12px; border-radius: 8px 8px 0 0; background: var(--pf-dk-chassis); color: var(--pf-dk-ink2); font-size: 12px; box-shadow: 0 0 0 1px var(--pf-dk-line2); }
.pf-ln [hidden] { display: none !important; }

/* ---------- 13 Flotantes: panel ---------- */
.pf-ov-panel[data-pf-min] { display: none; }
.pf-ov-panel.pf-dk-fl--drag { transform: rotate(-1.5deg); cursor: grabbing; user-select: none; box-shadow: 0 0 0 1px var(--pf-dk-ph), 0 30px 44px rgba(0, 0, 0, .65); }
.pf-ov-panel.pf-dk-fl--right {
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: auto !important;
  inline-size: var(--pf-fl-size, 360px) !important;
  block-size: auto !important;
  max-inline-size: calc(100vw - 16px) !important;
  max-block-size: none !important;
  border-radius: 0 !important;
  transform: none !important;
}
.pf-ov-panel.pf-dk-fl--bottom {
  top: auto !important;
  right: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  inline-size: auto !important;
  max-inline-size: none !important;
  block-size: var(--pf-fl-size, 320px) !important;
  max-block-size: none !important;
  border-radius: 0 !important;
  transform: none !important;
}
.pf-dk-fl-ghost { position: fixed; z-index: var(--pf-zf-marks); border: 1px dashed var(--pf-dk-lit-line); border-radius: 12px; background: rgba(108, 92, 231, .08); pointer-events: none; }
.pf-dk-fl-hint { position: fixed; pointer-events: none; background: var(--pf-dk-desk); }
.pf-dk-fl-zone { position: fixed; display: grid; place-items: center; box-sizing: border-box; border: 1px dashed var(--pf-dk-lit-line); background: rgba(108, 92, 231, .12); color: var(--pf-dk-ph); font: 600 12px var(--pf-dk-lab); text-align: center; pointer-events: none; }
.pf-dk-fl-zone[hidden] { display: none; }
.pf-dk-fl-zone--right { top: 0; right: 0; bottom: 0; inline-size: 96px; }
.pf-dk-fl-zone--bottom { right: 0; bottom: 0; left: 0; block-size: 56px; }
.pf-dk-fl-zone--hot { border-style: solid; background: rgba(108, 92, 231, .32); color: #fff; }
.pf-dk-fl-edge { position: fixed; pointer-events: auto; touch-action: none; }
.pf-dk-fl-edge--right { top: 0; bottom: 0; inline-size: 6px; margin-right: -3px; cursor: ew-resize; background: linear-gradient(90deg, transparent, rgba(143, 131, 240, .5)); }
.pf-dk-fl-edge--bottom { right: 0; left: 0; block-size: 6px; margin-bottom: -3px; cursor: ns-resize; background: linear-gradient(0deg, transparent, rgba(143, 131, 240, .5)); }
.pf-dk-fl-edge:hover, .pf-dk-fl-edge:focus-visible { outline: 0; box-shadow: 0 0 0 1px var(--pf-dk-teal); }
.pf-dk-fl-pill { position: fixed; right: 24px; bottom: 84px; inline-size: 280px; max-inline-size: calc(100vw - 32px); box-sizing: border-box; pointer-events: auto; background: var(--pf-dk-chassis); box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 10px 24px rgba(0, 0, 0, .5); }
.pf-dk-fl-pill[hidden] { display: none; }

/* ---------- 13 Flotantes: pin y popover ---------- */
.pf-pins-layer .pf-pin { min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 50% 50% 50% 4px; background: var(--pf-dk-solid); color: #fff; font: 700 13px var(--pf-dk-mono); box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0, 0, 0, .35); }
.pf-pins-layer .pf-pin.pf-pin--g { background: #2a8f9e; }
.pf-pins-layer .pf-pin[data-flash] { outline: 2px solid var(--pf-dk-teal); outline-offset: 3px; }
.pf-pins-layer .pf-pin:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: 2px; }
/* En vivo: «en curso» pulsa suave en turquesa; «resuelto» pasa a verde y se atenúa (pin fantasma). */
.pf-pins-layer .pf-pin[data-live="working"] { background: var(--pf-dk-teal); color: #0b1c1f; animation: pf-pin-working 1.2s ease-in-out 2; }
.pf-pins-layer .pf-pin--ghost { pointer-events: none; }
.pf-pins-layer .pf-pin--ghost[data-live="done"] { animation: pf-pin-done 2.2s ease-out forwards; }
@keyframes pf-pin-working { 0%, 100% { box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0, 0, 0, .35), 0 0 0 2px rgba(116, 196, 208, 0); } 50% { box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(0, 0, 0, .35), 0 0 0 10px rgba(116, 196, 208, .4); } }
@keyframes pf-pin-done { 0% { background: var(--pf-dk-solid); opacity: 1; transform: scale(1); } 25% { background: var(--pf-dk-green); color: #0b1c12; opacity: 1; transform: scale(1.12); } 55% { background: var(--pf-dk-green); color: #0b1c12; opacity: 1; transform: scale(1); } 100% { background: var(--pf-dk-green); color: #0b1c12; opacity: 0; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .pf-pins-layer .pf-pin[data-live="working"] { animation: none; }
  .pf-pins-layer .pf-pin--ghost[data-live="done"] { animation: pf-pin-done-rm 2.2s linear forwards; }
  @keyframes pf-pin-done-rm { 0%, 60% { background: var(--pf-dk-green); color: #0b1c12; opacity: 1; } 100% { background: var(--pf-dk-green); color: #0b1c12; opacity: 0; } }
}
.pf-pins-layer .pf-pin .pf-pin__tip { padding: 8px 10px; border: 0; border-radius: var(--pf-dk-r); background: var(--pf-dk-chassis); color: var(--pf-dk-ink); font: 500 12px/1.45 var(--pf-dk-mono); box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 10px 24px rgba(0, 0, 0, .5); }
.pf-pins-layer .pf-pin[data-open] .pf-pin__tip { display: none; }
.pf-pins-layer .pf-dk-fl-pop { position: fixed; pointer-events: auto; inline-size: 260px; max-inline-size: calc(100vw - 16px); box-sizing: border-box; overflow: hidden; }
.pf-dk-fl-pophd { padding: 8px 10px; border-bottom: 1px solid var(--pf-dk-line); }
.pf-dk-fl-popbd { padding: 10px 12px 12px; }
.pf-dk-fl-note { white-space: pre-wrap; overflow-wrap: anywhere; max-block-size: 9rem; overflow: auto; }
.pf-dk-fl-acts { margin-top: 2px; }
.pf-dk-fl-popbd textarea { min-block-size: 4.5rem; }
`;
