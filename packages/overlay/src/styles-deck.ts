/**
 * CSS compartido del «Comment Deck» (nuevo look del overlay; ver deck.ts y `.design/overlay-layer-immersive-minimalist.html`).
 * Solo clases `pf-dk-*` y variables `--pf-dk-*`, definidas en `:host` del Shadow DOM: no tocan la página ni chocan con
 * `pf-ov-*` / `pf-dz-*`. Sin fuentes ni recursos de red: la pila tipográfica del diseño lleva fallbacks del sistema.
 * El deck es oscuro por diseño (no define modo claro): `color-scheme: dark` en las unidades hace que los controles
 * nativos (select, color, scrollbars) concuerden. Se concatena a `CSS` en styles.ts (punto único de ensamblado).
 */
export const deckCss = `
:host {
  --pf-dk-desk: #0c0c0e;
  --pf-dk-chassis: #131316;
  --pf-dk-ink: #e4e4e7;
  --pf-dk-ink2: #9a9aa3;
  --pf-dk-paper: #e4e4e7;
  --pf-dk-ph: #a39df2;
  --pf-dk-ph2: #8b8b94;
  --pf-dk-solid: #6c5ce7;
  --pf-dk-solid-hover: #7b6dee;
  --pf-dk-lcd: #101012;
  --pf-dk-field: #0c0c0e;
  --pf-dk-line: #27272a;
  --pf-dk-line2: #2e2e33;
  --pf-dk-key: #1c1c20;
  --pf-dk-key-hover: #242428;
  --pf-dk-lit-bg: #1f1d36;
  --pf-dk-lit-fg: #d6d2ff;
  --pf-dk-lit-line: #5a4fd0;
  --pf-dk-amber: #d4b46a;
  --pf-dk-teal: #74c4d0;
  --pf-dk-green: #82c79b;
  --pf-dk-red: #e5867a;
  --pf-dk-red-solid: #c4473a;
  --pf-dk-lab: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --pf-dk-mono: 'Google Sans Code', 'Google Sans Flex', ui-monospace, SFMono-Regular, 'Cascadia Code', Consolas, Menlo, monospace;
  --pf-dk-r: 8px;
}

/* Chasis: remapea los tokens --pf-* a la paleta del deck, así todo lo que vive dentro (incluidas las piezas pf-ov-* / pf-dz-*) concuerda. */
.pf-dk-unit {
  color-scheme: dark;
  --pf-color-bg: var(--pf-dk-field);
  --pf-color-surface: var(--pf-dk-key);
  --pf-color-surface-raised: var(--pf-dk-chassis);
  --pf-color-border: var(--pf-dk-line2);
  --pf-color-text: var(--pf-dk-ink);
  --pf-color-text-muted: var(--pf-dk-ink2);
  --pf-color-accent: var(--pf-dk-ph);
  --pf-color-accent-hover: var(--pf-dk-solid-hover);
  --pf-color-accent-fg: #0c0c0e;
  --pf-color-danger: var(--pf-dk-red);
  --pf-status-pending-fg: var(--pf-dk-amber);
  --pf-status-resolved-fg: var(--pf-dk-green);
  --pf-status-in-progress-bg: #26262b;
  --pf-status-in-progress-fg: var(--pf-dk-ink);
  --pf-status-archived-bg: #26262b;
  --pf-status-archived-fg: var(--pf-dk-ink2);
  --pf-radius-sm: 5px;
  --pf-radius-md: var(--pf-dk-r);
  --pf-radius-lg: 12px;
  font-family: var(--pf-dk-lab);
  background: var(--pf-dk-chassis);
  color: var(--pf-dk-ink);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 0 0 1px var(--pf-dk-line), 0 10px 24px rgba(0, 0, 0, .4);
}
.pf-dk-unit :where(button, input, select, textarea) { font: inherit; color: inherit; }
.pf-dk-model { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font: 600 12px var(--pf-dk-lab); letter-spacing: .04em; color: #6b6b74; }
.pf-dk-model b { color: var(--pf-dk-ink2); font-weight: 700; }
.pf-dk-model i { flex: 1; height: 1px; background: var(--pf-dk-line); }

/* Utilidades de maquetación */
.pf-dk-fx { display: flex; align-items: center; }
.pf-dk-col { display: flex; flex-direction: column; }
.pf-dk-wr { flex-wrap: wrap; }
.pf-dk-grow { flex: 1; min-width: 0; }
.pf-dk-g6 { gap: 6px; } .pf-dk-g8 { gap: 8px; } .pf-dk-g12 { gap: 12px; } .pf-dk-g16 { gap: 16px; } .pf-dk-g24 { gap: 24px; }
.pf-dk-ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-dk-sep { height: 1px; margin: 12px 0; background: var(--pf-dk-line); border: 0; }

/* Etiquetas y texto de LCD */
.pf-dk-lab { font: 600 12px var(--pf-dk-lab); letter-spacing: .01em; color: var(--pf-dk-ink2); }
.pf-dk-lab--p { color: var(--pf-dk-paper); }
.pf-dk-lcd { position: relative; border-radius: var(--pf-dk-r); color: var(--pf-dk-ink); font-family: var(--pf-dk-mono); background: var(--pf-dk-lcd); box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-lp { padding: 8px 10px; }
.pf-dk-t1 { margin: 0; font: 500 26px/1 var(--pf-dk-mono); color: #f4f4f5; }
.pf-dk-t2 { margin: 0; font: 500 15px/1.2 var(--pf-dk-mono); color: #f4f4f5; }
.pf-dk-tx { margin: 0; font: 500 13px/1.5 var(--pf-dk-mono); color: #d4d4d8; }
.pf-dk-ts { margin: 0; font: 500 12px/1.45 var(--pf-dk-mono); color: #8f8f98; }
.pf-dk-tg { margin: 0; font: 500 12px/1.45 var(--pf-dk-mono); color: #f4f4f5; }
.pf-dk-tone-amber { color: var(--pf-dk-amber); } .pf-dk-tone-teal { color: var(--pf-dk-teal); } .pf-dk-tone-green { color: var(--pf-dk-green); }
.pf-dk-tone-red { color: var(--pf-dk-red); } .pf-dk-tone-violet { color: var(--pf-dk-ph); }
.pf-dk-lrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #1f1f23; }
.pf-dk-lrow:first-child { border-top: 0; }
.pf-dk-lin { display: block; inline-size: 100%; box-sizing: border-box; resize: none; border: 1px solid var(--pf-dk-line2); border-radius: var(--pf-dk-r); padding: 10px 12px; background: var(--pf-dk-field); color: #f4f4f5; font: 500 14px/1.5 var(--pf-dk-mono); caret-color: var(--pf-dk-ph); }
.pf-dk-lin:focus { outline: 1px solid var(--pf-dk-ph); outline-offset: 0; }
.pf-dk-lin::placeholder { color: #6b6b74; }
.pf-dk-lin:disabled { opacity: .6; }
.pf-dk-tagk { display: inline-grid; place-items: center; flex: none; min-width: 40px; height: 30px; padding: 0 8px; border-radius: var(--pf-dk-r); background: #26262b; color: var(--pf-dk-ink); font: 700 13px var(--pf-dk-mono); }
.pf-dk-idhdr { align-items: flex-start; }
.pf-dk-id { min-width: 0; }
.pf-dk-id h2 small { font-weight: 400; }
.pf-dk-warn { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 8px 10px; border-radius: var(--pf-dk-r); border: 1px solid #5a4a23; background: #1d1a11; color: var(--pf-dk-amber); font: 500 12px/1.45 var(--pf-dk-mono); }
.pf-dk-warn > svg { flex: none; margin-top: 1px; }
.pf-dk-warn--bad { border-color: #5c2b26; background: #1e1211; color: var(--pf-dk-red); }

/* Teclas */
.pf-dk-key { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 36px; min-width: 36px; padding: 0 12px; border: 0; border-radius: var(--pf-dk-r); cursor: pointer; background: var(--pf-dk-key); box-shadow: 0 0 0 1px var(--pf-dk-line2); color: var(--pf-dk-ink); font: 600 12.5px var(--pf-dk-lab); letter-spacing: .01em; white-space: nowrap; transition: background .12s; }
.pf-dk-key:hover:not(:disabled) { background: var(--pf-dk-key-hover); }
.pf-dk-key:active:not(:disabled) { box-shadow: 0 0 0 1px #3a3a40; }
.pf-dk-key--lit { background: var(--pf-dk-lit-bg); color: var(--pf-dk-lit-fg); box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-key--lit:hover:not(:disabled) { background: var(--pf-dk-lit-bg); }
.pf-dk-key[aria-pressed="true"], .pf-dk-key[aria-selected="true"] { background: var(--pf-dk-lit-bg); color: var(--pf-dk-lit-fg); box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-key--hot { background: var(--pf-dk-solid); color: #fff; box-shadow: none; }
.pf-dk-key--hot:hover:not(:disabled) { background: var(--pf-dk-solid-hover); }
.pf-dk-key--ghost { background: transparent; box-shadow: none; color: var(--pf-dk-ink2); }
.pf-dk-key--ghost:hover:not(:disabled) { background: var(--pf-dk-key); color: var(--pf-dk-ink); }
.pf-dk-key--dng { background: var(--pf-dk-red-solid); color: #fff; box-shadow: none; }
.pf-dk-key--dng:hover:not(:disabled) { background: #d4574a; }
.pf-dk-key--sq { padding: 0; width: 36px; }
.pf-dk-key--sm { height: 28px; min-width: 28px; padding: 0 8px; font-size: 12px; }
.pf-dk-key--sm.pf-dk-key--sq { width: 28px; padding: 0; }
.pf-dk-key--tall { height: 52px; flex-direction: column; gap: 4px; }
.pf-dk-key:disabled { opacity: .42; cursor: not-allowed; }
.pf-dk-key:focus-visible, .pf-dk-tog:focus-visible, .pf-dk-chip:focus-visible { outline: 2px solid var(--pf-dk-teal); outline-offset: 2px; }
.pf-dk-cnt { padding: 0 7px; border-radius: var(--pf-dk-r); background: #2a2a30; color: #d4d4d8; font: 500 11px/18px var(--pf-dk-mono); letter-spacing: 0; }
.pf-dk-key--lit .pf-dk-cnt { background: #2e2a57; color: var(--pf-dk-lit-fg); }
.pf-dk-tray { display: flex; gap: 6px; padding: 6px; border-radius: var(--pf-dk-r); background: #0e0e10; box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-tray > .pf-dk-key { flex: 1; }
.pf-dk-kb { display: inline-block; padding: 1px 7px; border-radius: var(--pf-dk-r); background: #232327; color: #d4d4d8; font: 600 11px/17px var(--pf-dk-mono); box-shadow: 0 0 0 1px var(--pf-dk-line2); }

/* LED y chips */
.pf-dk-led { flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34343a; }
.pf-dk-led--on { background: var(--pf-dk-ph); }
.pf-dk-led--teal.pf-dk-led--on { background: var(--pf-dk-teal); }
.pf-dk-led--green.pf-dk-led--on { background: var(--pf-dk-green); }
.pf-dk-led--amber.pf-dk-led--on { background: var(--pf-dk-amber); }
.pf-dk-led--red.pf-dk-led--on { background: var(--pf-dk-red); }
.pf-dk-chip { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px; border: 0; border-radius: var(--pf-dk-r); background: #18181b; box-shadow: 0 0 0 1px var(--pf-dk-line); font: 500 12px var(--pf-dk-mono); color: var(--pf-dk-ink2); white-space: nowrap; }
.pf-dk-chip--on { color: var(--pf-dk-ink); }
button.pf-dk-chip { cursor: pointer; }
button.pf-dk-chip:hover { background: var(--pf-dk-key-hover); }
.pf-dk-incl { margin-top: 12px; }

/* Interruptor y progreso */
.pf-dk-tog { position: relative; flex: none; width: 44px; height: 24px; padding: 0; border: 0; border-radius: var(--pf-dk-r); cursor: pointer; background: #2a2a30; }
.pf-dk-tog::after { content: ''; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: #d4d4d8; transition: transform .15s; }
.pf-dk-tog[aria-pressed="true"] { background: var(--pf-dk-solid); }
.pf-dk-tog[aria-pressed="true"]::after { transform: translateX(20px); background: #fff; }
.pf-dk-pbar { height: 8px; border-radius: var(--pf-dk-r); background: var(--pf-dk-key); overflow: hidden; }
.pf-dk-pbar i { display: block; block-size: 100%; background: var(--pf-dk-ph); }
.pf-dk-pbar--ok i { background: var(--pf-dk-green); }

/* Rack, número y miniatura */
.pf-dk-rack { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--pf-dk-r); background: var(--pf-dk-lcd); box-shadow: 0 0 0 1px #1f1f23; }
.pf-dk-rack--cur { box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-num { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 7px; background: var(--pf-dk-key); color: #d4d4d8; font: 500 15px var(--pf-dk-mono); }
.pf-dk-thumb { position: relative; height: 64px; border-radius: var(--pf-dk-r); box-shadow: 0 0 0 1px var(--pf-dk-line); background: var(--pf-dk-key) center / cover no-repeat; }
.pf-dk-thumb span { position: absolute; left: 4px; bottom: 3px; font: 600 10px var(--pf-dk-mono); color: #fff; text-shadow: 0 1px 2px #000; }

/* Perilla (capa 07) */
.pf-dk-knob { position: relative; width: 76px; height: 76px; flex: none; }
.pf-dk-knob .pf-dk-ticks { position: absolute; top: 0; right: 0; bottom: 0; left: 0; border-radius: 50%; background: conic-gradient(from 138deg, #26282e 0 84deg, transparent 84deg), repeating-conic-gradient(from -135deg, rgba(228, 228, 231, .4) 0 1deg, transparent 1.4deg 27deg); -webkit-mask: radial-gradient(circle, transparent 0 58%, #000 59% 67%, transparent 68%); mask: radial-gradient(circle, transparent 0 58%, #000 59% 67%, transparent 68%); }
.pf-dk-knob .pf-dk-well { position: absolute; inset: 14px; border-radius: 50%; background: #0c0c0e; box-shadow: 0 0 0 2px var(--pf-dk-line); }
.pf-dk-knob .pf-dk-cap { position: absolute; inset: 4px; border-radius: 50%; transform: rotate(var(--pf-dk-rot, 0deg)); background: radial-gradient(circle at 34% 26%, #4a4a52, #26262b 60%, #1c1c20); box-shadow: 0 0 0 1px #0b0c0e; }
.pf-dk-knob .pf-dk-cap::after { content: ''; position: absolute; left: 50%; top: 9%; width: 4px; height: 24%; margin-left: -2px; border-radius: 2px; background: var(--pf-dk-ph); }
.pf-dk-knob--hot .pf-dk-cap { background: radial-gradient(circle at 34% 28%, #b9afff, #8f83f0 42%, #4b3bc4); }
.pf-dk-knob--hot .pf-dk-cap::after { background: #fff; }
.pf-dk-knob--lock .pf-dk-cap { filter: grayscale(1) brightness(.7); }

/* Campos de inspector (.fld / .segs / .isec / .tk / .diff) */
.pf-dk-isec { border-top: 1px solid var(--pf-dk-line); padding: 12px 0 4px; }
.pf-dk-fld { display: flex; align-items: center; height: 30px; border-radius: var(--pf-dk-r); background: var(--pf-dk-field); box-shadow: 0 0 0 1px var(--pf-dk-line); overflow: hidden; font: 500 12px var(--pf-dk-mono); color: var(--pf-dk-ink); }
.pf-dk-fld--chg { box-shadow: 0 0 0 1px var(--pf-dk-solid); }
.pf-dk-fld:focus-within { box-shadow: 0 0 0 1px var(--pf-dk-teal); }
.pf-dk-segs { display: flex; height: 30px; border-radius: var(--pf-dk-r); background: var(--pf-dk-field); box-shadow: 0 0 0 1px var(--pf-dk-line); padding: 2px; gap: 2px; }
.pf-dk-segs > button { flex: 1; border: 0; border-radius: 5px; background: transparent; color: #a1a1aa; display: grid; place-items: center; cursor: pointer; font: 500 11.5px var(--pf-dk-lab); }
.pf-dk-segs > button[aria-pressed="true"], .pf-dk-segs > button.pf-dk-on { background: #26244a; color: #fff; }
.pf-dk-tk { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 5px; background: #1d1b33; color: var(--pf-dk-lit-fg); font: 500 11px var(--pf-dk-mono); white-space: nowrap; }
.pf-dk-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font: 500 13px/1.45 var(--pf-dk-mono); }
.pf-dk-diff small { display: block; }
.pf-dk-diff del { color: var(--pf-dk-ink2); }
.pf-dk-diff ins { text-decoration: underline; text-decoration-color: var(--pf-dk-ph); color: #f4f4f5; }

@media (prefers-reduced-motion: reduce) { .pf-dk-key, .pf-dk-tog, .pf-dk-tog::after { transition: none; } }
`;
