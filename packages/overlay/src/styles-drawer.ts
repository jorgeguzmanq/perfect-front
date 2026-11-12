/**
 * CSS de las capas 10 «Cajón» y 11 «Agente» del Comment Deck (clases pf-dk-* del deck + pf-dw-* de posición/estructura).
 * Va después de overlayV2Css y deckCss: los selectores `.pf-dw.pf-dk-unit` ganan a las reglas antiguas del cajón.
 */
export const drawerDeckCss = `
.pf-dw.pf-dk-unit { display: flex; flex-direction: column; gap: 14px; padding: 14px; inline-size: min(26rem, calc(100vw - var(--pf-space-4))); max-block-size: min(40rem, calc(100vh - 6rem)); box-sizing: border-box; background: var(--pf-dk-chassis); border: 0; border-radius: 12px; color: var(--pf-dk-ink); }
.pf-dw.pf-dk-unit[hidden] { display: none; }
.pf-dw .pf-dw-head { padding: 8px 10px; }
.pf-dw .pf-dw-head .pf-dk-t2 .pf-dk-ts { font-weight: 400; }
.pf-dw .pf-dw-body { overflow: auto; display: flex; flex-direction: column; gap: 0; padding: 8px 10px; min-block-size: 8rem; flex: 1; }
.pf-dw .pf-dw-body.pf-dk-lcd { background: var(--pf-dk-lcd); }
.pf-dw > .pf-dw-body:not(.pf-dk-lcd) { padding: 0; }

/* Fila de comentario */
.pf-dw-row { gap: 8px; }
.pf-dw-row[data-flash] { outline: 2px solid var(--pf-dk-teal); outline-offset: -2px; border-radius: 6px; }
.pf-dw-ci { display: block; min-inline-size: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; font: inherit; }
.pf-dw-ci:hover .pf-dk-tg { text-decoration: underline; text-decoration-color: var(--pf-dk-line2); }
.pf-dw-ci:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: 2px; border-radius: 4px; }
.pf-dw-ci--done .pf-dk-tg { opacity: .65; }
.pf-dw-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pf-dw .pf-dw-gtag { block-size: 20px; padding: 0 8px; font-size: 11px; gap: 5px; }
.pf-dw-acts { flex: none; }
.pf-dw-card { display: flex; flex-direction: column; border-top: 1px solid #1f1f23; }
.pf-dw-card > .pf-dk-lrow { border-top: 0; }
.pf-dw-del { display: flex; flex-direction: column; gap: 10px; padding: 0 0 10px; }
.pf-dw-btns { justify-content: flex-end; }
.pf-dw-edit { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.pf-dw-bar { padding: 4px 0 8px; }

/* Grupos */
.pf-dw-gcard { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 12px; }
.pf-dw-gcard + .pf-dw-gcard { border-top: 1px solid var(--pf-dk-line); padding-top: 12px; }
.pf-dw-q.pf-dk-lcd { padding: 4px 10px; }
.pf-dw-qi { cursor: grab; }
.pf-dw-qi--done { opacity: .65; }
.pf-dw-qi--over { box-shadow: 0 -2px 0 var(--pf-dk-ph); }

/* Capa 11: panel Enviar a agente */
.pf-dw-agent { gap: 14px; }
.pf-dw-agent-body { gap: 10px; }
.pf-dw-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.pf-dw-agent-sent { padding: 10px; }
`;
