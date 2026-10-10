import tokensCss from '@perfect-front/design-tokens/tokens.css?inline';
import baseCss from '@perfect-front/design-tokens/base.css?inline';

/**
 * CSS propio del overlay: solo variables --pf-* y clases .pf-*.
 * El host (`:host`) se aísla con `all: initial` para que el CSS de la página no lo afecte;
 * el Shadow Root impide que estos estilos afecten a la página.
 */
const overlayCss = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: var(--pf-z-overlay);
  pointer-events: none;
}
.pf-ov-layer { position: fixed; inset: 0; pointer-events: none; }
/* base.css pinta .pf-root con fondo sólido: las capas que cubren el viewport DEBEN ser transparentes. */
.pf-ov-layer.pf-root, .pf-pins-layer.pf-root, .pf-ln.pf-root { background: transparent; }
.pf-ov-highlight {
  position: fixed;
  pointer-events: none;
  border: var(--pf-focus-ring-width) solid var(--pf-color-accent);
  background: color-mix(in srgb, var(--pf-color-accent) 14%, transparent);
  border-radius: var(--pf-radius-sm);
}
.pf-ov-label {
  position: absolute;
  bottom: 100%;
  left: 0;
  max-width: 100%;
  padding: 0 var(--pf-space-2);
  background: var(--pf-color-accent);
  color: var(--pf-color-accent-fg);
  font-size: var(--pf-font-size-xs);
  font-family: var(--pf-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pf-ov-panel {
  position: fixed;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: var(--pf-space-3);
  width: min(26rem, 100vw);
  max-width: calc(100vw - var(--pf-space-4));
  max-height: calc(100vh - var(--pf-space-4));
  overflow: auto;
  padding: var(--pf-space-3) var(--pf-space-4) var(--pf-space-4);
  background: var(--pf-color-surface-raised);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-lg);
  box-shadow: var(--pf-shadow-lg);
}
.pf-ov-panel--view { top: var(--pf-space-4); right: var(--pf-space-4); }
.pf-ov-toolbar {
  position: fixed;
  bottom: var(--pf-space-4);
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--pf-space-3);
  padding: var(--pf-space-2) var(--pf-space-3);
  background: var(--pf-color-surface-raised);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-lg);
  box-shadow: var(--pf-shadow-md);
}
.pf-ov-title { margin: 0; font-size: var(--pf-font-size-lg); font-weight: var(--pf-font-weight-bold); }
.pf-ov-field { display: flex; flex-direction: column; gap: var(--pf-space-1); }
.pf-ov-hint { margin: 0; font-size: var(--pf-font-size-sm); color: var(--pf-color-text-muted); }
.pf-ov-code {
  margin: 0;
  font-family: var(--pf-font-mono);
  font-size: var(--pf-font-size-xs);
  color: var(--pf-color-text-muted);
  overflow-wrap: anywhere;
}
.pf-ov-error { margin: 0; font-size: var(--pf-font-size-sm); color: var(--pf-color-danger); }
.pf-ov-actions { display: flex; flex-wrap: wrap; gap: var(--pf-space-2); justify-content: flex-end; }
.pf-ov-textarea { resize: vertical; min-height: calc(var(--pf-control-height) * 3); }
.pf-ov-tip {
  position: fixed;
  right: var(--pf-space-4);
  bottom: var(--pf-space-4);
  padding: var(--pf-space-1) var(--pf-space-2);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-color-text);
  color: var(--pf-color-bg);
  font-family: var(--pf-font-mono);
  font-size: var(--pf-font-size-xs);
  pointer-events: none;
}
.pf-ov-tip[hidden], .pf-ov-highlight[hidden] { display: none; }
.pf-ov-head { display: flex; align-items: center; gap: var(--pf-space-2); min-width: 0; }
.pf-ov-tag { font-family: var(--pf-font-mono); font-weight: var(--pf-font-weight-bold); }
.pf-ov-src { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-ov-tools { display: flex; align-items: center; gap: var(--pf-space-1); margin-inline-start: auto; }
.pf-ov-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--pf-control-height);
  height: var(--pf-control-height);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--pf-radius-md);
  background: transparent;
  color: var(--pf-color-text-muted);
  cursor: pointer;
}
.pf-ov-iconbtn:hover:not(:disabled) { background: var(--pf-color-surface); color: var(--pf-color-text); }
.pf-ov-iconbtn:disabled { opacity: 0.4; cursor: not-allowed; }
.pf-ov-iconbtn:focus-visible, .pf-ov-tab:focus-visible, .pf-ov-segbtn:focus-visible,
.pf-ov-level:focus-visible, .pf-ov-check input:focus-visible {
  outline: var(--pf-focus-ring);
  outline-offset: var(--pf-focus-ring-offset);
}
.pf-ov-titlerow { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--pf-space-2); min-width: 0; }
.pf-ov-chain { margin: 0; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); overflow-wrap: anywhere; }
.pf-ov-chain[hidden] { display: none; }
.pf-ov-tabs {
  display: flex;
  gap: var(--pf-space-1);
  border-bottom: 1px solid var(--pf-color-border);
  margin: 0 calc(var(--pf-space-4) * -1);
  padding: 0 var(--pf-space-4);
}
.pf-ov-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--pf-space-2);
  padding: var(--pf-space-2) var(--pf-space-3);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--pf-color-text-muted);
  font-weight: var(--pf-font-weight-medium);
  cursor: pointer;
}
.pf-ov-tab--on { color: var(--pf-color-accent); border-bottom-color: var(--pf-color-accent); }
.pf-ov-badge {
  padding: 0 var(--pf-space-2);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-color-surface);
  color: var(--pf-color-text-muted);
  font-size: var(--pf-font-size-xs);
}
.pf-ov-pane { display: flex; flex-direction: column; gap: var(--pf-space-3); }
.pf-ov-pane[hidden] { display: none; }
.pf-ov-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-md);
  overflow: hidden;
}
.pf-ov-segbtn {
  padding: var(--pf-space-2) var(--pf-space-3);
  border: 0;
  background: transparent;
  color: var(--pf-color-text-muted);
  cursor: pointer;
}
.pf-ov-segbtn[aria-pressed="true"] { background: var(--pf-color-surface); color: var(--pf-color-text); font-weight: var(--pf-font-weight-medium); }
.pf-ov-segbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.pf-ov-foot { display: flex; align-items: center; gap: var(--pf-space-2); margin: 0; min-width: 0; }
.pf-ov-path { min-width: 0; font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); overflow-wrap: anywhere; }
.pf-ov-check { display: inline-flex; align-items: center; gap: var(--pf-space-2); font-size: var(--pf-font-size-sm); cursor: pointer; }
.pf-ov-levels { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--pf-space-1); max-height: 16rem; overflow: auto; }
.pf-ov-level {
  display: block;
  width: 100%;
  padding: var(--pf-space-1) var(--pf-space-2);
  border: 0;
  border-radius: var(--pf-radius-sm);
  background: transparent;
  color: var(--pf-color-text);
  font-family: var(--pf-font-mono);
  font-size: var(--pf-font-size-xs);
  text-align: start;
  cursor: pointer;
}
.pf-ov-level:hover { background: var(--pf-color-surface); }
.pf-ov-level[aria-current="true"] { background: var(--pf-color-surface); color: var(--pf-color-accent); font-weight: var(--pf-font-weight-bold); }
.pf-pins-layer { position: fixed; inset: 0; pointer-events: none; background: transparent; }
.pf-pin {
  position: fixed;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 var(--pf-space-1);
  border: 2px solid var(--pf-color-accent-fg);
  border-radius: var(--pf-radius-full) var(--pf-radius-full) var(--pf-radius-full) var(--pf-radius-sm);
  background: var(--pf-color-accent);
  color: var(--pf-color-accent-fg);
  font-size: var(--pf-font-size-xs);
  font-weight: var(--pf-font-weight-bold);
  line-height: 1;
  box-shadow: var(--pf-shadow-md);
  pointer-events: auto;
  cursor: pointer;
}
.pf-pin[hidden] { display: none; }
.pf-pin:focus-visible { outline: var(--pf-focus-ring); outline-offset: var(--pf-focus-ring-offset); }
.pf-pin__tip {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  width: max-content;
  max-width: 18rem;
  margin-top: var(--pf-space-1);
  padding: var(--pf-space-2) var(--pf-space-3);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-md);
  background: var(--pf-color-surface-raised);
  color: var(--pf-color-text);
  font-weight: var(--pf-font-weight-regular);
  text-align: start;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  box-shadow: var(--pf-shadow-lg);
}
.pf-pin:hover .pf-pin__tip, .pf-pin:focus-visible .pf-pin__tip, .pf-pin[data-open] .pf-pin__tip { display: block; }
.pf-ln { position: fixed; inset: 0; pointer-events: none; background: transparent; }
.pf-ln > * { pointer-events: auto; position: fixed; right: var(--pf-space-4); }
.pf-ln-group {
  bottom: var(--pf-space-4);
  display: flex;
  align-items: stretch;
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-full);
  background: var(--pf-color-surface-raised);
  color: var(--pf-color-text);
  box-shadow: var(--pf-shadow-lg);
  overflow: hidden;
}
.pf-ln-group[hidden], .pf-ln-tab[hidden], .pf-ln-menu[hidden], .pf-ln-toast[hidden], .pf-ln-info[hidden] { display: none; }
.pf-ln-main, .pf-ln-more {
  display: inline-flex;
  align-items: center;
  gap: var(--pf-space-2);
  min-height: 2.5rem;
  border: 0;
  background: transparent;
  color: inherit;
  font-weight: var(--pf-font-weight-medium);
  cursor: pointer;
}
.pf-ln-main { padding: 0 var(--pf-space-3) 0 var(--pf-space-4); }
.pf-ln-more { padding: 0 var(--pf-space-3); border-inline-start: 1px solid var(--pf-color-border); color: var(--pf-color-text-muted); }
.pf-ln-main:hover, .pf-ln-more:hover { background: var(--pf-color-surface); }
.pf-ln-main--on { background: var(--pf-color-accent); color: var(--pf-color-accent-fg); }
.pf-ln-main--on:hover { background: var(--pf-color-accent-hover); }
.pf-ln-main:focus-visible, .pf-ln-more:focus-visible, .pf-ln-tab:focus-visible,
.pf-ln-item:focus-visible, .pf-ln-toastx:focus-visible {
  outline: var(--pf-focus-ring);
  outline-offset: calc(var(--pf-focus-ring-offset) * -1);
}
.pf-ln-badge {
  min-width: 1.5rem;
  padding: 0 var(--pf-space-2);
  border-radius: var(--pf-radius-full);
  background: var(--pf-color-accent);
  color: var(--pf-color-accent-fg);
  font-size: var(--pf-font-size-xs);
  font-weight: var(--pf-font-weight-bold);
  line-height: 1.5rem;
  text-align: center;
}
.pf-ln-main--on .pf-ln-badge { background: var(--pf-color-accent-fg); color: var(--pf-color-accent); }
.pf-ln-tab {
  bottom: var(--pf-space-2);
  min-height: 2.25rem;
  padding: 0 var(--pf-space-3);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-md) var(--pf-radius-md) 0 0;
  background: var(--pf-color-surface-raised);
  color: var(--pf-color-text-muted);
  font-size: var(--pf-font-size-xs);
  box-shadow: var(--pf-shadow-md);
  cursor: pointer;
}
.pf-ln-menu {
  bottom: calc(var(--pf-space-4) + 3rem);
  display: flex;
  flex-direction: column;
  min-width: 12rem;
  max-width: calc(100vw - var(--pf-space-6));
  padding: var(--pf-space-1);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-md);
  background: var(--pf-color-surface-raised);
  color: var(--pf-color-text);
  box-shadow: var(--pf-shadow-lg);
}
.pf-ln-item {
  padding: var(--pf-space-2) var(--pf-space-3);
  border: 0;
  border-radius: var(--pf-radius-sm);
  background: transparent;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.pf-ln-item:hover { background: var(--pf-color-surface); }
.pf-ln-info { margin: 0; padding: var(--pf-space-2) var(--pf-space-3); font-size: var(--pf-font-size-xs); color: var(--pf-color-text-muted); font-family: var(--pf-font-mono); overflow-wrap: anywhere; }
.pf-ln-toast {
  bottom: calc(var(--pf-space-4) + 3.25rem);
  display: flex;
  align-items: center;
  gap: var(--pf-space-3);
  max-width: min(24rem, calc(100vw - var(--pf-space-6)));
  padding: var(--pf-space-2) var(--pf-space-3);
  border: 1px solid var(--pf-color-border);
  border-radius: var(--pf-radius-md);
  background: var(--pf-color-surface-raised);
  color: var(--pf-color-text);
  font-size: var(--pf-font-size-sm);
  box-shadow: var(--pf-shadow-lg);
}
.pf-ln-toastx { display: inline-flex; padding: var(--pf-space-1); border: 0; background: transparent; color: var(--pf-color-text-muted); cursor: pointer; }
.pf-ov-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
`;

export const CSS = tokensCss + '\n' + baseCss + '\n' + overlayCss;

export function injectStylesIntoShadowRoot(shadowRoot: ShadowRoot, doc: Document = document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.textContent = CSS;
  shadowRoot.appendChild(style);
  return style;
}
