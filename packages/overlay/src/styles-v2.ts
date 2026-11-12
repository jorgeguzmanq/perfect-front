/**
 * CSS del editor v2 (pila de vistas: base «Comentar» + subvistas, menú «⋯», bandeja, «Incluye», copiar ubicación, imágenes, estilos, orden,
 * grupo) y del cajón de comentarios. Solo clases `.pf-ov-*` / `.pf-dw-*` y variables `--pf-*`; se concatena
 * a `CSS` en styles.ts.
 */
import { CLIPBOARD_CSS } from './clipboard-styles';

export const overlayV2Css = `
.pf-ov-panel--v2 { gap: var(--pf-space-2); width: min(26rem, 100vw); padding: var(--pf-space-3); }
.pf-ov-panel--v2 button:focus-visible, .pf-ov-panel--v2 select:focus-visible, .pf-ov-panel--v2 input:focus-visible,
.pf-dw button:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-ov-head2 { display: flex; align-items: flex-start; gap: var(--pf-space-2); min-width: 0; }
.pf-ov-id { flex: 1; min-width: 0; }
.pf-ov-id .pf-ov-title { font-size: var(--pf-font-size-md); }
.pf-ov-id small { font-weight: var(--pf-font-weight-regular); color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); }
.pf-ov-sub { margin: 0; font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ov-copywrap { position: relative; }
.pf-ov-copypop {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 2; width: 18rem; max-width: calc(100vw - 2rem); padding: var(--pf-space-1);
  background: var(--pf-color-surface-raised); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); box-shadow: var(--pf-shadow-lg);
}
.pf-ov-copypop h5 { margin: 0; padding: var(--pf-space-1) var(--pf-space-2); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); font-weight: var(--pf-font-weight-medium); }
.pf-ov-cp { display: flex; align-items: center; gap: var(--pf-space-2); width: 100%; padding: var(--pf-space-2); border: 0; border-radius: var(--pf-radius-sm); background: transparent; color: var(--pf-color-text); text-align: start; cursor: pointer; }
.pf-ov-cp:hover:not(:disabled) { background: var(--pf-color-surface); }
.pf-ov-cp:disabled { opacity: .5; cursor: not-allowed; }
.pf-ov-cp > span:first-child { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pf-ov-cp b { font-size: var(--pf-font-size-sm); }
.pf-ov-cp code { font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ov-done { flex: none; font-size: var(--pf-font-size-xs); font-weight: var(--pf-font-weight-bold); color: var(--pf-status-resolved-fg); }
.pf-ov-tray { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pf-space-1); }
.pf-ov-tray[hidden], .pf-ov-inc[hidden] { display: none; }
.pf-ov-tchip { display: inline-flex; align-items: center; gap: var(--pf-space-1); padding: 0 var(--pf-space-1) 0 var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-full); font-size: var(--pf-font-size-xs); }
.pf-ov-tchip[aria-current="true"] { border-color: var(--pf-color-accent); background: color-mix(in srgb, var(--pf-color-accent) 12%, transparent); }
.pf-ov-tchip i { font-style: normal; font-weight: var(--pf-font-weight-bold); color: var(--pf-color-accent); }
.pf-ov-tfocus, .pf-ov-tx { border: 0; background: transparent; color: inherit; font: inherit; font-family: var(--pf-font-mono); cursor: pointer; padding: 0; display: inline-flex; }
.pf-ov-target { display: flex; flex-direction: column; gap: var(--pf-space-2); }
.pf-ov-row { display: flex; align-items: center; gap: var(--pf-space-2); flex-wrap: wrap; }
.pf-ov-nav { display: flex; align-items: center; gap: var(--pf-space-2); }
.pf-ov-nav--off { opacity: .45; pointer-events: none; }
.pf-ov-ngrp { display: inline-flex; align-items: center; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); }
.pf-ov-pos { min-width: 2.5rem; text-align: center; font-size: var(--pf-font-size-xs); font-family: var(--pf-font-mono); color: var(--pf-color-text-muted); }
.pf-ov-sp { flex: 1; }
.pf-btn--sm { min-height: 1.75rem; padding: 0 var(--pf-space-2); font-size: var(--pf-font-size-xs); }
.pf-btn--on { background: var(--pf-color-accent); color: var(--pf-color-accent-fg); }
.pf-btn--ghost { background: transparent; border-color: transparent; }
.pf-ov-body { display: flex; flex-direction: column; gap: var(--pf-space-3); padding: var(--pf-space-1) 0; }
.pf-ov-body:not([data-view="comment"]) { min-height: 6rem; max-height: 22rem; overflow: auto; }
.pf-ov-panel--v2 .pf-ov-tabs { margin: 0 calc(var(--pf-space-3) * -1); padding: 0 var(--pf-space-2); overflow-x: auto; }
.pf-ov-tab:disabled { opacity: .4; cursor: not-allowed; }
.pf-ov-badge--dot { width: .5rem; height: .5rem; padding: 0; border-radius: var(--pf-radius-full); background: var(--pf-color-accent); }
.pf-ov-inc { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pf-space-1); padding-top: var(--pf-space-2); border-top: 1px solid var(--pf-color-border); }
.pf-ov-inc small { color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); }
.pf-ov-foot2 { display: flex; flex-direction: column; gap: var(--pf-space-1); }
.pf-ov-foot2 .pf-ov-actions { align-items: center; }
.pf-ov-field--bad .pf-ov-textarea { border-color: var(--pf-color-danger); }
.pf-ov-fieldfoot { display: flex; align-items: center; justify-content: space-between; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-linkbtn { display: inline-flex; align-items: center; gap: var(--pf-space-1); border: 0; background: transparent; color: var(--pf-color-accent); font-size: var(--pf-font-size-xs); cursor: pointer; padding: 0; }
.pf-ov-linkbtn:disabled { color: var(--pf-color-text-muted); cursor: not-allowed; opacity: .6; }
.pf-ov-msg { display: flex; align-items: flex-start; gap: var(--pf-space-2); margin: 0; font-size: var(--pf-font-size-sm); }
.pf-ov-msg--err { color: var(--pf-color-danger); }
.pf-ov-msg--warn { color: var(--pf-status-pending-fg); font-size: var(--pf-font-size-xs); }
.pf-ov-sect { display: flex; align-items: center; justify-content: space-between; font-size: var(--pf-font-size-xs); font-weight: var(--pf-font-weight-bold); color: var(--pf-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.pf-ov-count { font-weight: var(--pf-font-weight-medium); text-transform: none; letter-spacing: 0; }
.pf-ov-count--full { color: var(--pf-color-danger); }
.pf-ov-dz { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-2) var(--pf-space-3); border: 1px dashed var(--pf-color-border); border-radius: var(--pf-radius-md); font-size: var(--pf-font-size-sm); color: var(--pf-color-text-muted); }
.pf-ov-dz-idle { display: flex; align-items: center; gap: var(--pf-space-2); flex-wrap: wrap; width: 100%; }
.pf-ov-dz-idle > span { flex: 1; min-width: 8rem; }
.pf-ov-dz-over { display: none; flex-direction: column; align-items: center; gap: var(--pf-space-1); width: 100%; padding: var(--pf-space-3) 0; color: var(--pf-color-accent); }
.pf-ov-dz--over { border-color: var(--pf-color-accent); background: color-mix(in srgb, var(--pf-color-accent) 10%, transparent); }
.pf-ov-dz--over .pf-ov-dz-over { display: flex; }
.pf-ov-dz--over .pf-ov-dz-idle { display: none; }
.pf-ov-dz--full { opacity: .7; }
.pf-ov-thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--pf-space-2); }
.pf-ov-th { position: relative; display: flex; flex-direction: column; gap: 2px; font-size: var(--pf-font-size-xs); min-width: 0; }
.pf-ov-th-img { display: block; aspect-ratio: 4 / 3; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); background: var(--pf-color-surface) center / cover no-repeat; }
.pf-ov-th-k { position: absolute; top: 4px; left: 4px; padding: 0 var(--pf-space-1); border-radius: var(--pf-radius-sm); background: var(--pf-color-text); color: var(--pf-color-bg); font-size: 10px; }
.pf-ov-th-x { position: absolute; top: 2px; right: 2px; width: 1.25rem; height: 1.25rem; background: var(--pf-color-surface-raised); border-color: var(--pf-color-border); }
.pf-ov-th-meta { display: flex; justify-content: space-between; gap: var(--pf-space-1); color: var(--pf-color-text-muted); }
.pf-ov-th-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-ov-th-move { font-size: var(--pf-font-size-xs); max-width: 100%; }
.pf-ov-dest { display: flex; align-items: center; gap: var(--pf-space-2); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-section { display: flex; flex-direction: column; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); }
.pf-ov-section-head { display: flex; gap: var(--pf-space-2); }
.pf-ov-section-head .pf-input { flex: 1; }
.pf-ov-textarea--sm { min-height: calc(var(--pf-control-height) * 2); }
.pf-ov-empty { display: flex; flex-direction: column; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-4); text-align: center; font-size: var(--pf-font-size-sm); color: var(--pf-color-text-muted); }
.pf-ov-empty b { color: var(--pf-color-text); }
.pf-ov-ck { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-2); border-radius: var(--pf-radius-md); background: var(--pf-color-surface); }
.pf-ov-ck b, .pf-ov-ck small { display: block; }
.pf-ov-ck small { font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-where { margin-inline-start: auto; max-width: 10rem; font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ov-ckey { display: flex; align-items: center; gap: var(--pf-space-2); }
.pf-ov-ckey code { font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-ckey .pf-ov-hint { margin-inline-start: auto; }
.pf-ov-tagpill { padding: 0 var(--pf-space-2); border-radius: var(--pf-radius-sm); background: var(--pf-status-archived-bg); color: var(--pf-status-archived-fg); font-size: var(--pf-font-size-xs); }
.pf-ov-langs { display: inline-flex; gap: var(--pf-space-1); }
.pf-ov-langbtn { display: inline-flex; align-items: center; gap: var(--pf-space-1); padding: 0 var(--pf-space-2); min-height: 1.75rem; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); background: transparent; color: var(--pf-color-text); font-size: var(--pf-font-size-xs); cursor: pointer; }
.pf-ov-langbtn[aria-pressed="true"] { background: var(--pf-color-surface); border-color: var(--pf-color-accent); }
.pf-ov-dot { width: .5rem; height: .5rem; border-radius: var(--pf-radius-full); background: transparent; }
.pf-ov-dot--ed { background: var(--pf-color-accent); }
.pf-ov-dot--miss { background: var(--pf-status-pending-fg); }
.pf-ov-vars { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pf-space-1); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-vchip { padding: 0 var(--pf-space-2); border-radius: var(--pf-radius-sm); background: var(--pf-color-surface); font-family: var(--pf-font-mono); }
.pf-ov-vchip em { font-style: normal; color: var(--pf-color-text-muted); }
.pf-ov-diff { display: grid; grid-template-columns: 1fr 1fr; gap: var(--pf-space-2); font-size: var(--pf-font-size-sm); }
.pf-ov-diff small { display: block; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-diff del { color: var(--pf-color-text-muted); }
.pf-ov-diff ins { text-decoration: underline; color: var(--pf-status-resolved-fg); }
.pf-ov-pick { display: flex; flex-direction: column; gap: var(--pf-space-2); }
.pf-ov-pick label { display: flex; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); cursor: pointer; font-size: var(--pf-font-size-sm); }
.pf-ov-lrows { display: flex; flex-direction: column; gap: 2px; font-size: var(--pf-font-size-sm); }
.pf-ov-lrows > div { display: flex; gap: var(--pf-space-2); }
.pf-ov-lrows b { width: 1.75rem; font-family: var(--pf-font-mono); }
.pf-ov-miss { font-style: italic; color: var(--pf-color-text-muted); }
.pf-ov-legend { display: grid; grid-template-columns: 1fr 1fr; gap: var(--pf-space-2); }
.pf-ov-lg { display: flex; gap: var(--pf-space-2); padding: var(--pf-space-2); border-radius: var(--pf-radius-md); font-size: var(--pf-font-size-xs); }
.pf-ov-lg b { display: block; }
.pf-ov-lg--ed { background: color-mix(in srgb, var(--pf-color-accent) 10%, transparent); }
.pf-ov-lg--lk { background: var(--pf-color-surface); color: var(--pf-color-text-muted); }
.pf-ov-applyto { display: flex; align-items: center; justify-content: space-between; font-size: var(--pf-font-size-sm); }
.pf-ov-summ, .pf-ov-mvnote { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-2); border-radius: var(--pf-radius-md); background: color-mix(in srgb, var(--pf-color-accent) 10%, transparent); font-size: var(--pf-font-size-xs); }
.pf-ov-summ span, .pf-ov-mvnote span { flex: 1; }
.pf-ov-sgroup { display: flex; flex-direction: column; gap: var(--pf-space-1); }
.pf-ov-sgroup h6 { margin: 0; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.pf-ov-srow { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--pf-space-2); }
.pf-ov-srow--chg .pf-ov-sl small { color: var(--pf-color-accent); }
.pf-ov-sl b { display: block; font-size: var(--pf-font-size-sm); font-family: var(--pf-font-mono); }
.pf-ov-sl small { font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-tok { font-family: var(--pf-font-mono); }
.pf-ov-numw, .pf-ov-colw, .pf-ov-selw { display: inline-flex; align-items: center; gap: var(--pf-space-1); }
.pf-ov-numw input, .pf-ov-colw input, .pf-ov-selw select { width: 6rem; min-height: 1.75rem; padding: 0 var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); background: var(--pf-color-bg); color: var(--pf-color-text); font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-numw em { font-style: normal; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-colw i { width: 1rem; height: 1rem; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); }
.pf-ov-collapse { display: flex; align-items: center; gap: var(--pf-space-2); width: 100%; border: 0; background: transparent; color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); cursor: pointer; padding: var(--pf-space-1) 0; }
.pf-ov-collapse svg:last-child { margin-inline-start: auto; }
.pf-ov-collapse[aria-expanded="true"] svg:last-child { transform: rotate(180deg); }
.pf-ov-fr { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--pf-space-2); padding: var(--pf-space-1) 0; font-size: var(--pf-font-size-xs); border-top: 1px solid var(--pf-color-border); }
.pf-ov-fr b { font-family: var(--pf-font-mono); }
.pf-ov-fr .pf-ov-v { display: inline-flex; align-items: center; gap: var(--pf-space-1); }
.pf-ov-fr .pf-ov-v i { width: .75rem; height: .75rem; border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-color-border); }
.pf-ov-fr small { color: var(--pf-color-text-muted); }
.pf-ov-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pf-space-1); font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-crumbs button { border: 0; background: transparent; color: var(--pf-color-accent); cursor: pointer; font: inherit; padding: 0; }
.pf-ov-parentbox { border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); overflow: hidden; }
.pf-ov-parentbox header { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-2); background: var(--pf-color-surface); font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-parentbox header span { margin-inline-start: auto; color: var(--pf-color-text-muted); font-family: var(--pf-font-sans); }
.pf-ov-sib { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-1) var(--pf-space-2); border-top: 1px solid var(--pf-color-border); }
.pf-ov-sib[aria-current="true"] { background: color-mix(in srgb, var(--pf-color-accent) 10%, transparent); cursor: grab; }
.pf-ov-sib--moved { box-shadow: inset 3px 0 0 var(--pf-color-accent); }
.pf-ov-sib .pf-ov-g { color: var(--pf-color-text-muted); display: inline-flex; }
.pf-ov-sib .pf-ov-i { width: 1.25rem; text-align: center; font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-sib .pf-ov-l { flex: 1; min-width: 0; font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); }
.pf-ov-sib .pf-ov-l small { display: block; font-family: var(--pf-font-sans); color: var(--pf-color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ov-btns { display: inline-flex; }
.pf-ov-gsel { display: flex; gap: var(--pf-space-2); }
.pf-ov-gsel select { flex: 1; min-height: 2rem; }
.pf-ov-tgl { display: flex; align-items: center; justify-content: space-between; gap: var(--pf-space-3); font-size: var(--pf-font-size-sm); cursor: pointer; }
.pf-ov-tgl small { display: block; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-q { display: flex; flex-direction: column; gap: var(--pf-space-1); }
.pf-ov-qi { display: flex; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); }
.pf-ov-qi--me { border-color: var(--pf-color-accent); }
.pf-ov-qi--done { opacity: .6; }
.pf-ov-qn { flex: none; width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--pf-radius-full); background: var(--pf-color-surface); font-size: var(--pf-font-size-xs); font-weight: var(--pf-font-weight-bold); }
.pf-ov-qc { min-width: 0; font-size: var(--pf-font-size-sm); }
.pf-ov-qc p { margin: 0; }
.pf-ov-qc small { display: flex; gap: var(--pf-space-1); align-items: center; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-ov-sw { appearance: none; width: 2rem; height: 1.125rem; border-radius: var(--pf-radius-full); background: var(--pf-color-border); position: relative; cursor: pointer; transition: background var(--pf-duration-fast); }
.pf-ov-sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: .875rem; height: .875rem; border-radius: var(--pf-radius-full); background: var(--pf-color-bg); transition: transform var(--pf-duration-fast); }
.pf-ov-sw:checked { background: var(--pf-color-accent); }
.pf-ov-sw:checked::after { transform: translateX(.875rem); }
.pf-ov-ins { position: fixed; pointer-events: none; background: var(--pf-color-accent); border-radius: var(--pf-radius-full); }
.pf-ov-ins-label { position: fixed; pointer-events: none; padding: 0 var(--pf-space-2); border-radius: var(--pf-radius-sm); background: var(--pf-color-accent); color: var(--pf-color-accent-fg); font-size: var(--pf-font-size-xs); font-family: var(--pf-font-mono); }
.pf-ov-highlight--extra { background: color-mix(in srgb, var(--pf-color-accent) 8%, transparent); border-style: dashed; }
.pf-ov-highlight--hover { background: color-mix(in srgb, var(--pf-color-accent) 14%, transparent); border-style: dotted; }
.pf-ly { display: flex; flex-direction: column; gap: 1px; }
.pf-ly-row { display: flex; align-items: center; gap: var(--pf-space-1); min-height: 1.75rem; padding: 0 var(--pf-space-2); padding-inline-start: calc(var(--pf-space-2) + (var(--pf-ly-level, 1) - 1) * var(--pf-space-3)); border-radius: var(--pf-radius-sm); color: var(--pf-color-text); font-size: var(--pf-font-size-xs); cursor: pointer; }
.pf-ly-row:hover { background: var(--pf-color-surface); }
.pf-ly-row:focus-visible { outline: var(--pf-focus-ring); outline-offset: -2px; }
.pf-ly-row[aria-selected="true"] { background: color-mix(in srgb, var(--pf-color-accent) 12%, transparent); }
.pf-ly-row--focus { font-weight: var(--pf-font-weight-bold); box-shadow: inset 2px 0 0 var(--pf-color-accent); }
.pf-ly-row--ancestor { color: var(--pf-color-text-muted); }
.pf-ly-row svg { flex: none; color: var(--pf-color-text-muted); }
.pf-ly-label { flex: 1; min-width: 0; font-family: var(--pf-font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ly-comp { flex: none; padding: 0 var(--pf-space-1); border-radius: var(--pf-radius-sm); background: var(--pf-status-in-progress-bg); color: var(--pf-status-in-progress-fg); font-weight: var(--pf-font-weight-medium); }
.pf-ly-cmt { flex: none; min-width: 1.1rem; padding: 0 var(--pf-space-1); border-radius: var(--pf-radius-full); background: var(--pf-color-accent); color: var(--pf-color-accent-fg); font-size: .625rem; font-weight: var(--pf-font-weight-bold); text-align: center; }
.pf-ly-more { padding-inline-start: calc(var(--pf-space-2) + (var(--pf-ly-level, 1) - 1) * var(--pf-space-3)); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-dw-code { flex: none; }
.pf-ov-iconbtn[data-pf-open]:disabled { opacity: .4; cursor: not-allowed; }
/* Cajón de comentarios */
.pf-dw { position: fixed; right: var(--pf-space-4); bottom: calc(var(--pf-space-4) + 3.5rem); pointer-events: auto; display: flex; flex-direction: column; width: min(23rem, calc(100vw - var(--pf-space-4))); max-height: min(36rem, calc(100vh - 6rem)); background: var(--pf-color-surface-raised); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-lg); box-shadow: var(--pf-shadow-lg); color: var(--pf-color-text); }
.pf-dw-grip { display: block; }
[data-pf-grip]:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-dw[hidden] { display: none; }
.pf-dw-head { display: flex; align-items: center; justify-content: space-between; padding: var(--pf-space-3) var(--pf-space-3) 0; }
.pf-dw-head h2 { margin: 0; font-size: var(--pf-font-size-md); }
.pf-dw-head small { margin-inline-start: var(--pf-space-2); color: var(--pf-color-text-muted); font-weight: var(--pf-font-weight-regular); font-size: var(--pf-font-size-xs); }
.pf-dw .pf-ov-tabs { margin: 0; }
.pf-dw-body { overflow: auto; display: flex; flex-direction: column; gap: var(--pf-space-1); padding: var(--pf-space-2); }
.pf-dw-ci { display: flex; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 0; border-radius: var(--pf-radius-md); background: transparent; color: inherit; text-align: start; cursor: pointer; font-size: var(--pf-font-size-sm); }
.pf-dw-ci:hover { background: var(--pf-color-surface); }
.pf-dw-ci--done { opacity: .65; }
.pf-dw-ci p { margin: 0; }
.pf-dw-ci small { display: flex; flex-wrap: wrap; gap: var(--pf-space-1); align-items: center; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-dw-gtag { padding: 0 var(--pf-space-1); border-radius: var(--pf-radius-sm); background: var(--pf-status-archived-bg); color: var(--pf-status-archived-fg); font-size: 10px; font-weight: var(--pf-font-weight-bold); }
.pf-dw-row { display: flex; align-items: center; gap: var(--pf-space-1); }
.pf-dw-row > .pf-dw-ci { flex: 1; min-width: 0; }
.pf-dw-card { display: flex; flex-direction: column; gap: var(--pf-space-1); }
.pf-dw-acts { display: flex; gap: var(--pf-space-1); justify-content: flex-end; }
.pf-dw-edit, .pf-dw-del { display: flex; flex-direction: column; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); font-size: var(--pf-font-size-sm); }
.pf-dw-del { border-color: var(--pf-color-danger); }
.pf-dw-del p { margin: 0; }
.pf-btn--danger { background: var(--pf-color-danger); border-color: var(--pf-color-danger); color: #fff; }
.pf-dw-gcard { display: flex; flex-direction: column; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); }
.pf-dw-gcard header { display: flex; gap: var(--pf-space-2); }
.pf-dw-gcard header small { display: block; color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); }
.pf-dw-gcard footer { display: flex; gap: var(--pf-space-2); }
.pf-dw-q .pf-ov-qi { cursor: grab; }
.pf-dw-q .pf-ov-qi--over { box-shadow: 0 -2px 0 var(--pf-color-accent); }
@media (prefers-reduced-motion: reduce) { .pf-ov-sw, .pf-ov-sw::after { transition: none; } }
/* Captura de nodo (capa propia: marco + barra de escalas + tarjeta de resultado) */
.pf-cap { pointer-events: none; }
.pf-cap-frame {
  position: fixed; pointer-events: none; box-sizing: border-box;
  border: var(--pf-focus-ring-width) dashed var(--pf-color-accent);
  box-shadow: 0 0 0 9999px color-mix(in srgb, #000 35%, transparent);
  border-radius: var(--pf-radius-sm);
}
.pf-cap-frame[hidden] { display: none; }
.pf-cap-panel {
  position: fixed; bottom: var(--pf-space-4); left: 50%; transform: translateX(-50%); pointer-events: auto;
  display: flex; flex-direction: column; gap: var(--pf-space-2); width: min(26rem, calc(100vw - 2rem)); max-height: 80vh; overflow: auto;
  padding: var(--pf-space-3); background: var(--pf-color-surface-raised); border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-lg); box-shadow: var(--pf-shadow-lg);
}
.pf-cap-panel button:focus-visible, .pf-cap-panel input:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-cap-head { display: flex; align-items: center; gap: var(--pf-space-2); }
.pf-cap-id { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pf-cap-id small { color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); font-family: var(--pf-font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-cap-modes { display: flex; gap: var(--pf-space-1); }
.pf-cap-scales { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--pf-space-2); }
.pf-cap-scale { display: flex; align-items: center; gap: var(--pf-space-2); padding: var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); cursor: pointer; }
.pf-cap-scale:has(input:checked) { border-color: var(--pf-color-accent); background: color-mix(in srgb, var(--pf-color-accent) 10%, transparent); }
.pf-cap-scale--off { opacity: .5; cursor: not-allowed; }
.pf-cap-scale-t { display: flex; flex-direction: column; min-width: 0; }
.pf-cap-scale-t small { color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); font-family: var(--pf-font-mono); }
.pf-cap-foot, .pf-ov-shot-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--pf-space-2); }
.pf-ov-shot-actions:empty { display: none; }
.pf-cap-progress, .pf-cap-err { margin: 0; font-size: var(--pf-font-size-sm); }
.pf-cap-progress { color: var(--pf-color-text-muted); font-family: var(--pf-font-mono); }
.pf-cap-err { color: var(--pf-status-pending-fg, var(--pf-color-text)); }
.pf-cap-shots { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--pf-space-2); max-height: 14rem; overflow: auto; }
.pf-cap-shot { display: flex; align-items: center; gap: var(--pf-space-2); }
.pf-cap-thumb { flex: none; width: 3rem; height: 3rem; object-fit: contain; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); background: var(--pf-color-surface); }
.pf-cap-meta { min-width: 0; display: flex; flex-direction: column; }
.pf-cap-meta b { font-size: var(--pf-font-size-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-cap-meta small { color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); }

.pf-dz { display: flex; flex-direction: column; gap: var(--pf-space-2); }
.pf-dz button:focus-visible, .pf-dz input:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-dz-sec { border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-md); background: var(--pf-color-surface); }
.pf-dz-sech { display: flex; align-items: center; gap: var(--pf-space-2); width: 100%; min-height: 2rem; padding: 0 var(--pf-space-2); border: 0; background: transparent; color: var(--pf-color-text); font-size: var(--pf-font-size-sm); cursor: pointer; text-align: start; }
.pf-dz-sech b { font-weight: var(--pf-font-weight-medium); }
.pf-dz-sech svg:last-child { margin-inline-start: auto; color: var(--pf-color-text-muted); }
.pf-dz-sech[aria-expanded="true"] svg:last-child { transform: rotate(180deg); }
.pf-dz-chg { min-width: 1.25rem; padding: 0 var(--pf-space-1); border-radius: var(--pf-radius-full); background: var(--pf-color-accent); color: var(--pf-color-accent-fg); font-size: var(--pf-font-size-xs); text-align: center; }
.pf-dz-secb { padding: var(--pf-space-2); border-top: 1px solid var(--pf-color-border); background: var(--pf-color-bg); border-radius: 0 0 var(--pf-radius-md) var(--pf-radius-md); }
.pf-dz-body { display: flex; flex-direction: column; gap: var(--pf-space-2); }
.pf-dz-field { display: flex; flex-direction: column; gap: var(--pf-space-1); min-width: 0; }
.pf-dz-lbl { font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-dz-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--pf-space-2); }
.pf-dz-tip, .pf-dz-note { font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); margin: 0; }
.pf-dz-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); overflow: hidden; align-self: flex-start; max-width: 100%; }
.pf-dz-segbtn { min-width: 1.75rem; min-height: 1.75rem; padding: 0 var(--pf-space-2); display: inline-flex; align-items: center; justify-content: center; border: 0; border-inline-end: 1px solid var(--pf-color-border); background: var(--pf-color-bg); color: var(--pf-color-text-muted); font: inherit; font-size: var(--pf-font-size-xs); cursor: pointer; }
.pf-dz-segbtn:last-child { border-inline-end: 0; }
.pf-dz-segbtn:hover:not(:disabled) { color: var(--pf-color-text); }
.pf-dz-segbtn[aria-pressed="true"] { background: var(--pf-color-accent); color: var(--pf-color-accent-fg); }
.pf-dz-segbtn:disabled { opacity: .5; cursor: not-allowed; }
.pf-dz-num { display: inline-flex; align-items: center; gap: var(--pf-space-1); min-width: 0; }
.pf-dz-num input, .pf-dz-colorrow input[type="text"] { width: 4rem; min-height: 1.75rem; padding: 0 var(--pf-space-1); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); background: var(--pf-color-bg); color: var(--pf-color-text); font-family: var(--pf-font-mono); font-size: var(--pf-font-size-xs); text-align: center; }
.pf-dz-num--text input { width: 100%; text-align: start; }
.pf-dz-num--text { display: flex; }
.pf-dz-num em { font-style: normal; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); }
.pf-dz-sides { position: relative; display: grid; grid-template-columns: repeat(3, auto); grid-template-areas: ". t ." "l c r" ". b ."; justify-content: center; gap: var(--pf-space-1); padding: var(--pf-space-2); border: 1px dashed var(--pf-color-border); border-radius: var(--pf-radius-sm); }
.pf-dz-sides--margin { background: color-mix(in srgb, var(--pf-color-accent) 6%, transparent); }
.pf-dz-sides--padding { background: color-mix(in srgb, var(--pf-color-accent) 12%, transparent); }
.pf-dz-sidelbl { position: absolute; top: 2px; left: 6px; font-size: .625rem; color: var(--pf-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
.pf-dz-sides .pf-dz-num input { width: 2.75rem; }
.pf-dz-side-top { grid-area: t; justify-self: center; }
.pf-dz-side-right { grid-area: r; }
.pf-dz-side-bottom { grid-area: b; justify-self: center; }
.pf-dz-side-left { grid-area: l; }
.pf-dz-inner { grid-area: c; display: grid; }
.pf-dz-core { display: none; }
.pf-dz-pills { display: inline-flex; gap: var(--pf-space-1); }
.pf-dz-pill { min-height: 1.5rem; padding: 0 var(--pf-space-2); border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-full); background: transparent; color: var(--pf-color-text-muted); font-size: var(--pf-font-size-xs); cursor: pointer; }
.pf-dz-pill[aria-pressed="true"] { border-color: var(--pf-color-accent); color: var(--pf-color-accent); background: color-mix(in srgb, var(--pf-color-accent) 12%, transparent); }
.pf-dz-colors { display: flex; flex-direction: column; gap: var(--pf-space-2); }
.pf-dz-swatches { display: flex; flex-wrap: wrap; gap: var(--pf-space-1); }
.pf-dz-swt { width: 1.5rem; height: 1.5rem; padding: 0; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); cursor: pointer; }
.pf-dz-swt--none { background: repeating-conic-gradient(var(--pf-color-border) 0 25%, var(--pf-color-bg) 0 50%) 0 0 / 8px 8px; }
.pf-dz-swt[aria-pressed="true"] { outline: 2px solid var(--pf-color-accent); outline-offset: 1px; }
.pf-dz-colorrow { display: flex; align-items: center; gap: var(--pf-space-2); }
.pf-dz-colorrow input[type="color"] { width: 2rem; height: 1.75rem; padding: 0; border: 1px solid var(--pf-color-border); border-radius: var(--pf-radius-sm); background: transparent; cursor: pointer; }
.pf-dz-colorrow input[type="text"] { flex: 1; width: auto; text-align: start; }
.pf-dz-range { width: 100%; accent-color: var(--pf-color-accent); }
/* ===== Editor · piel «Comment Deck» (reglas por clases viejas dentro de .pf-dk-unit; ver styles-deck.ts) ===== */
.pf-ov-panel--v2.pf-dk-unit { gap: 10px; padding: 12px; }
.pf-dk-unit .pf-ov-id .pf-ov-title { font-size: 15px; font-weight: 500; }
.pf-dk-unit .pf-ov-tools { margin-inline-start: 0; }
.pf-dk-unit .pf-ov-tabs { margin: 0; padding: 6px; border: 0; gap: 6px; overflow-x: auto; }
.pf-dk-unit .pf-ov-tab { flex: 1 1 auto; padding: 0 8px; gap: 6px; }
.pf-dk-unit .pf-ov-badge { padding: 0 6px; border-radius: 8px; background: #2a2a30; color: #d4d4d8; font: 500 11px/16px var(--pf-dk-mono); }
.pf-dk-unit .pf-ov-badge--dot { width: 8px; height: 8px; padding: 0; border-radius: 50%; background: var(--pf-dk-ph); }
.pf-dk-unit [aria-selected="true"] > .pf-ov-badge, .pf-dk-unit [aria-pressed="true"] > .pf-ov-badge { background: #2e2a57; color: var(--pf-dk-lit-fg); }
.pf-dk-unit .pf-ov-seg { display: flex; gap: 6px; padding: 6px; border: 0; border-radius: 8px; background: #0e0e10; box-shadow: 0 0 0 1px var(--pf-dk-line); overflow: visible; }
.pf-dk-unit .pf-ov-target { gap: 10px; }
.pf-dk-unit .pf-ov-nav { gap: 8px; flex-wrap: wrap; }
.pf-dk-unit .pf-ov-ngrp { border: 0; gap: 6px; }
.pf-dk-unit .pf-ov-pos { justify-content: center; min-width: 3rem; }
.pf-dk-unit .pf-ov-iconbtn { width: 32px; height: 32px; border-radius: 8px; color: var(--pf-dk-ink2); }
.pf-dk-unit .pf-ov-iconbtn:hover:not(:disabled) { background: var(--pf-dk-key-hover); color: var(--pf-dk-ink); }
.pf-dk-unit .pf-ov-tchip { padding: 0 4px 0 10px; border: 0; border-radius: 8px; }
.pf-dk-unit .pf-ov-tchip[aria-current="true"] { background: #18181b; box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-unit .pf-ov-tchip i { color: var(--pf-dk-ph); }
.pf-dk-unit .pf-ov-inc { border-top: 0; padding-top: 0; }
.pf-dk-unit .pf-ov-foot2 { gap: 8px; }
.pf-dk-unit .pf-ov-actions { align-items: center; }
.pf-dk-unit .pf-ov-keys { display: block; margin: 0; min-width: 8rem; }
.pf-dk-unit .pf-ov-body { gap: 10px; padding: 2px 0; }
.pf-dk-unit .pf-ov-body:not([data-view="comment"]) { min-height: 6rem; max-height: 24rem; }
.pf-dk-unit .pf-ov-field { gap: 4px; }
.pf-dk-unit .pf-ov-textarea { resize: vertical; }
.pf-dk-unit .pf-ov-fieldfoot { margin-top: 4px; }
.pf-dk-unit .pf-ov-dz { border: 0; }
.pf-dk-unit .pf-ov-dz--over { outline: 2px dashed var(--pf-dk-ph); outline-offset: -2px; background: var(--pf-dk-lcd); }
.pf-dk-unit .pf-ov-dz-over { color: var(--pf-dk-ph); }
.pf-dk-unit .pf-ov-section { border: 0; }
.pf-dk-unit .pf-ov-th-img { border: 0; box-shadow: 0 0 0 1px var(--pf-dk-line); border-radius: 8px; }
.pf-dk-unit .pf-ov-th-k { background: #26262b; color: var(--pf-dk-ink); }
.pf-dk-unit .pf-ov-th-x { width: 1.5rem; height: 1.5rem; background: #26262b; border: 0; }
.pf-dk-unit .pf-ov-copypop { padding: 6px; border: 0; border-radius: 8px; background: var(--pf-dk-chassis); box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 10px 24px rgba(0, 0, 0, .4); }
.pf-dk-unit .pf-ov-copypop h5 { color: var(--pf-dk-ink2); font-family: var(--pf-dk-lab); }
.pf-dk-unit .pf-ov-cp { padding: 10px 12px; }
.pf-dk-unit .pf-ov-cp:hover:not(:disabled) { background: var(--pf-dk-key-hover); }
.pf-dk-unit .pf-ov-dot--ed { background: var(--pf-dk-teal); }
.pf-dk-unit .pf-ov-dot--miss { background: var(--pf-dk-amber); }
.pf-dk-unit .pf-ov-pick { gap: 0; }
.pf-dk-unit .pf-ov-pick label { border: 0; border-top: 1px solid #1f1f23; border-radius: 0; padding: 8px 2px; }
.pf-dk-unit .pf-ov-pick label:first-child { border-top: 0; }
.pf-dk-unit .pf-ov-lrows > div { padding: 4px 0; border-top: 1px solid #1f1f23; }
.pf-dk-unit .pf-ov-lrows > div:first-child { border-top: 0; }
.pf-dk-unit .pf-ov-legend .pf-ov-lg { border-radius: 8px; }
.pf-dk-unit .pf-ov-numw input, .pf-dk-unit .pf-ov-colw input, .pf-dk-unit .pf-ov-selw select, .pf-dk-unit .pf-dz-num input, .pf-dk-unit .pf-dz-colorrow input[type="text"] { min-height: 30px; border: 0; border-radius: 8px; background: var(--pf-dk-field); box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-unit .pf-ov-numw input:focus, .pf-dk-unit .pf-ov-colw input:focus, .pf-dk-unit .pf-ov-selw select:focus, .pf-dk-unit .pf-dz-num input:focus { outline: 0; box-shadow: 0 0 0 1px var(--pf-dk-teal); }
.pf-dk-unit .pf-ov-gsel select { min-height: 30px; padding: 0 8px; border: 0; border-radius: 8px; background: var(--pf-dk-field); box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-unit .pf-ov-collapse { justify-content: flex-start; width: 100%; }
.pf-dk-unit .pf-ov-parentbox { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 0; }
.pf-dk-unit .pf-ov-parentbox header { padding: 2px 4px; background: transparent; color: var(--pf-dk-ink2); }
.pf-dk-unit .pf-ov-sib { border-top: 0; }
.pf-dk-unit .pf-ov-sib--moved { box-shadow: inset 3px 0 0 var(--pf-dk-ph), 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-unit .pf-ov-sib .pf-ov-i { width: 28px; font-size: 15px; }
.pf-dk-unit .pf-ov-crumbs button { color: var(--pf-dk-ph); }
.pf-dk-unit .pf-ov-q { gap: 8px; }
.pf-dk-unit .pf-ov-qi { border: 0; }
.pf-dk-unit .pf-ov-qi--me { box-shadow: 0 0 0 1px var(--pf-dk-lit-line); }
.pf-dk-unit .pf-ov-empty { gap: 10px; padding: 26px 16px; }
.pf-dk-unit .pf-ov-sw { width: 44px; height: 24px; border-radius: 8px; background: #2a2a30; }
.pf-dk-unit .pf-ov-sw::after { top: 3px; left: 3px; width: 18px; height: 18px; background: #d4d4d8; }
.pf-dk-unit .pf-ov-sw:checked { background: var(--pf-dk-solid); }
.pf-dk-unit .pf-ov-sw:checked::after { transform: translateX(20px); background: #fff; }
.pf-dk-unit .pf-dz-sec { border: 0; border-top: 1px solid var(--pf-dk-line); border-radius: 0; background: transparent; }
.pf-dk-unit .pf-dz-sech { padding: 0; font: 600 12.5px var(--pf-dk-lab); }
.pf-dk-unit .pf-dz-secb { padding: 4px 0 8px; border-top: 0; background: transparent; }
.pf-dk-unit .pf-dz-chg { border-radius: 8px; background: #2a2a30; color: #d4d4d8; }
.pf-dk-unit .pf-dz-seg { padding: 2px; gap: 2px; border: 0; border-radius: 8px; background: var(--pf-dk-field); box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-unit .pf-dz-segbtn { border-inline-end: 0; border-radius: 5px; background: transparent; }
.pf-dk-unit .pf-dz-segbtn[aria-pressed="true"] { background: #26244a; color: #fff; }
.pf-dk-unit .pf-dz-sides { border-radius: 8px; }
.pf-dk-unit .pf-dz-sides--margin { background: #17171a; border-color: #3a3a40; }
.pf-dk-unit .pf-dz-sides--padding { background: #1a1830; border-color: #4a43a8; }
.pf-dk-unit .pf-dz-pill { border-radius: 8px; }
.pf-dk-unit .pf-dz-pill[aria-pressed="true"] { border-color: var(--pf-dk-lit-line); background: var(--pf-dk-lit-bg); color: var(--pf-dk-lit-fg); }
.pf-dk-unit .pf-dz-swt { border-radius: 8px; }
/* ===== Pila de vistas (base «Comentar» + una subvista a la vez) ===== */
.pf-ov-panel--v2 [hidden] { display: none !important; }
.pf-dk-unit .pf-ov-head2 { align-items: center; }
.pf-ov-tools { flex: none; }
.pf-dk-unit .pf-ov-more { box-shadow: none; }
.pf-ov-menu {
  position: absolute; top: 3.5rem; right: var(--pf-space-3); z-index: 3; display: flex; flex-direction: column; gap: 2px;
  width: 15rem; max-width: calc(100% - 2 * var(--pf-space-3)); padding: 6px; border-radius: 8px;
  background: var(--pf-dk-chassis); box-shadow: 0 0 0 1px var(--pf-dk-line2), 0 10px 24px rgba(0, 0, 0, .4);
}
.pf-ov-menu[hidden] { display: none; }
.pf-ov-mi { display: flex; align-items: center; gap: var(--pf-space-2); justify-content: flex-start; width: 100%; padding: 0 10px; min-height: 32px; text-align: start; letter-spacing: .01em; }
.pf-ov-mi[aria-checked="true"] { color: var(--pf-dk-lit-fg); background: var(--pf-dk-lit-bg); }
.pf-ov-mi--danger { color: var(--pf-dk-red); }
.pf-ov-mi-k { margin-inline-start: auto; }
.pf-ov-subhdr { align-items: center; }
.pf-ov-back { gap: 4px; padding: 0 10px 0 6px; }
.pf-ov-viewtitle { margin: 0; font-size: 15px; font-weight: 500; }
.pf-ov-propose { gap: 6px; }
.pf-ov-propose .pf-dk-lab { margin-inline-end: 2px; }
.pf-ov-pchip { cursor: pointer; }
.pf-ov-pchip:focus-visible, .pf-ov-back:focus-visible, .pf-ov-mi:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-dk-unit .pf-ov-nav { gap: 6px; padding: 2px 0; flex-wrap: nowrap; }
.pf-dk-unit .pf-ov-nav .pf-dk-key--sq { width: 28px; height: 28px; }
.pf-ov-dz-idle > span { min-width: 0; font-size: var(--pf-font-size-xs); }
.pf-dk-unit .pf-ov-dz { padding: 8px 10px; }
.pf-ov-gh { justify-content: flex-start; gap: var(--pf-space-2); }
.pf-ov-gh b { font-weight: 600; font-size: 12.5px; color: var(--pf-color-text); }
.pf-ov-moreinfo > summary { cursor: pointer; padding: var(--pf-space-1) 0; color: var(--pf-color-text-muted); }
.pf-ov-moreinfo > summary:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
/* Transición entre vistas: translate + fade corta (≤ 180 ms); sin movimiento si el usuario pide menos animación. */
@keyframes pf-ov-vt-fwd { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
@keyframes pf-ov-vt-back { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.pf-ov-vt--fwd { animation: pf-ov-vt-fwd 160ms ease-out; }
.pf-ov-vt--back { animation: pf-ov-vt-back 160ms ease-out; }
@media (prefers-reduced-motion: reduce) { .pf-ov-vt--fwd, .pf-ov-vt--back { animation: none; } }
/* Marcas en la página (02 · Apuntar): resaltado, multiselección numerada, inserción y pista */
.pf-ov-highlight { border: 2px solid var(--pf-dk-solid, var(--pf-color-accent)); border-radius: 8px; background: rgba(108, 92, 231, .08); }
.pf-ov-highlight--extra { border-style: dashed; background: rgba(108, 92, 231, .05); }
.pf-ov-highlight--hover { border-style: dotted; background: rgba(108, 92, 231, .08); }
.pf-ov-label { left: -2px; padding: 1px 8px; border-radius: 4px 4px 0 0; background: var(--pf-dk-solid, var(--pf-color-accent)); color: #fff; font: 600 12px var(--pf-dk-mono, var(--pf-font-mono)); }
.pf-ov-highlight[data-n]::before { content: attr(data-n); position: absolute; top: -12px; left: -12px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--pf-dk-solid); color: #fff; font: 700 12px var(--pf-dk-mono); box-shadow: 0 0 0 2px var(--pf-dk-desk); }
.pf-ov-tip { border-radius: 8px; background: var(--pf-dk-lcd, var(--pf-color-text)); color: var(--pf-dk-ink, var(--pf-color-bg)); box-shadow: 0 0 0 1px var(--pf-dk-line, transparent); font-family: var(--pf-dk-mono, var(--pf-font-mono)); }
/* ===== Editor · aire y sin tarjetas anidadas (el chasis es la única tarjeta; dentro, campos y filas planas) ===== */
.pf-ov-panel--v2.pf-dk-unit { gap: 14px; padding: 16px; max-width: calc(100vw - 16px); }
.pf-dk-unit .pf-ov-body { gap: 14px; padding: 0; }
.pf-dk-unit .pf-ov-head2 { gap: 10px; padding: 0; background: transparent; box-shadow: none; }
.pf-dk-unit .pf-ov-head2 .pf-ov-id { display: flex; flex-direction: column; gap: 2px; }
.pf-dk-unit .pf-ov-id .pf-ov-title { margin: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pf-dk-unit .pf-ov-id .pf-ov-title small { display: block; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pf-dk-unit .pf-ov-tools { gap: 4px; }
.pf-dk-unit .pf-ov-field { display: flex; flex-direction: column; gap: 6px; padding: 0; background: transparent; box-shadow: none; }
.pf-dk-unit .pf-ov-fieldfoot { margin-top: 0; padding: 0 2px; }
.pf-dk-unit .pf-ov-textarea { min-height: 6.5rem; }
.pf-dk-unit .pf-ov-dz { background: transparent; box-shadow: none; border: 1px dashed var(--pf-dk-line2); padding: 10px 12px; }
.pf-dk-unit .pf-ov-dz-idle { gap: 8px 10px; flex-wrap: wrap; }
.pf-dk-unit .pf-ov-dz-idle > span { flex: 1 1 9rem; min-width: 9rem; font-size: 12px; line-height: 1.4; }
.pf-dk-unit .pf-ov-section { gap: 10px; padding: 12px; background: transparent; box-shadow: 0 0 0 1px var(--pf-dk-line); }
.pf-dk-unit .pf-ov-section .pf-ov-dz { padding: 8px 10px; }
.pf-dk-unit .pf-ov-propose { display: grid; grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr)); gap: 8px; align-items: stretch; padding-top: 4px; border-top: 1px solid var(--pf-dk-line); }
.pf-dk-unit .pf-ov-propose-lab { grid-column: 1 / -1; padding-top: 10px; }
.pf-dk-unit .pf-ov-propose .pf-ov-pchip { height: 32px; justify-content: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pf-dk-unit .pf-ov-inc { gap: 8px; }
.pf-dk-unit .pf-ov-foot2 { gap: 12px; padding-top: 4px; }
.pf-dk-unit .pf-ov-actions { flex-wrap: wrap; gap: 8px 12px; }
.pf-dk-unit .pf-ov-keys { display: flex; flex: 1 1 11rem; align-items: center; gap: 12px; min-width: 0; white-space: nowrap; }
` + CLIPBOARD_CSS;
