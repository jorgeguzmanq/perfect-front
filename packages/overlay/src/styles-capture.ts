/**
 * CSS de las capas 07 «Captura» y 12 «Capas» del Comment Deck (clases pf-dk-* del deck + pf-cap-* / pf-ly-*).
 * Va después de styles-v2 (ver styles.ts), así que gana a las reglas pf-cap-panel / pf-ly-* heredadas.
 * Sin fuentes ni red; tamaños con inline-size/block-size (no width/height:100%) por test/background.test.ts.
 */
export const captureDeckCss = `
/* 07 · Captura: panel y aviso rápido sobre el chasis del deck */
.pf-cap-panel.pf-dk-unit, .pf-cap-toast.pf-dk-unit { padding: 16px; color: var(--pf-dk-ink); }
.pf-cap-panel.pf-dk-unit { gap: 12px; width: min(30rem, calc(100vw - 2rem)); }
.pf-cap-toast.pf-dk-unit { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; flex-direction: column; gap: 12px; width: min(26rem, calc(100vw - 2rem)); }
.pf-cap-panel .pf-dk-model, .pf-cap-toast .pf-dk-model { margin-bottom: 0; }
.pf-cap-head { flex: none; }
.pf-cap-id { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pf-cap-kbs { display: inline-flex; gap: 4px; flex: none; }
.pf-cap-body { display: flex; flex-direction: column; gap: 12px; }
.pf-cap-scalekey { min-inline-size: 0; padding: 0 6px; }
.pf-cap-scalekey .pf-cap-sx { font: 600 20px/1 var(--pf-dk-mono); }
.pf-cap-scalekey .pf-dk-ts { letter-spacing: 0; text-transform: none; font-size: 11px; }
.pf-cap-opt { display: flex; flex-direction: column; gap: 6px; }
.pf-cap-optkey { padding: 0 10px; min-width: 44px; }
.pf-cap-foot { margin-top: 4px; flex-wrap: wrap; }
.pf-cap-rs { inline-size: 30px; }
.pf-cap-rp { inline-size: 48px; text-align: end; }
.pf-cap-shots { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 14rem; overflow: auto; }
.pf-cap-shot { display: block; }
.pf-cap-shot .pf-dk-rack { padding: 8px 10px; }
.pf-cap-thumb { flex: none; inline-size: 40px; block-size: 40px; object-fit: contain; border-radius: 6px; background: var(--pf-dk-key); box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-cap-meta { display: flex; flex-direction: column; min-width: 0; }
.pf-cap-meta b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-cap-cmp { align-items: stretch; }
.pf-cap-cmpcard { flex: 1; min-inline-size: 11rem; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.pf-cap-sample { display: inline-block; padding: 8px 18px; border-radius: 8px; background: var(--pf-dk-solid); color: #fff; font: 600 16px var(--pf-dk-lab); }
.pf-cap-sample--blur { filter: blur(1.5px); }
.pf-cap-toast-note { margin: 0; }

/* 12 · Capas: árbol dentro de un LCD (rol tree y teclado intactos) */
.pf-ly.pf-dk-lcd { display: flex; flex-direction: column; gap: 0; }
.pf-ly .pf-ly-row.pf-dk-lrow { min-height: 28px; padding: 4px 4px; padding-inline-start: calc(4px + (var(--pf-ly-level, 1) - 1) * 18px); gap: 8px; border-radius: 5px; border-top: 0; font-family: var(--pf-dk-mono); cursor: pointer; }
.pf-ly .pf-ly-row.pf-dk-lrow:hover { background: #17171a; }
.pf-ly .pf-ly-row[aria-selected="true"] { background: #17162b; box-shadow: none; }
.pf-ly .pf-ly-row--focus { box-shadow: inset 2px 0 0 var(--pf-dk-ph); font-weight: 400; }
.pf-ly .pf-ly-row:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: -2px; }
.pf-ly .pf-ly-label { flex: 1; min-width: 0; font-family: var(--pf-dk-mono); }
.pf-ly .pf-ly-comp { padding: 0 6px; border-radius: 5px; background: #1d1b33; color: var(--pf-dk-lit-fg); font: 500 11px var(--pf-dk-mono); }
.pf-ly .pf-ly-cmt { background: var(--pf-dk-solid); color: #fff; }
.pf-ly .pf-dk-chip { height: 20px; padding: 0 7px; font-size: 11px; }
.pf-ly-eye { flex: none; display: inline-grid; place-items: center; inline-size: 24px; block-size: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--pf-dk-ink2); cursor: pointer; }
.pf-ly-eye:hover { background: var(--pf-dk-key); color: var(--pf-dk-ink); }
.pf-ly-eye svg { color: inherit; }
.pf-ly-more.pf-dk-ts { padding-block: 4px; padding-inline-start: calc(4px + (var(--pf-ly-level, 1) - 1) * 18px); }
`;
