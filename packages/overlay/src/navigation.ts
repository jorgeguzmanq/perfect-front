/**
 * Avisa de navegaciones de una SPA: patch de history.pushState/replaceState + popstate/hashchange.
 * Devuelve la función de limpieza (restaura history si nadie más lo reemplazó).
 */
export function onNavigate(win: Window, cb: () => void): () => void {
  const history = win.history;
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  let active = true;
  const fire = () => {
    if (!active) return;
    try {
      cb();
    } catch {
      /* el consumidor no debe romper la navegación de la página */
    }
  };
  const push = function (this: History, ...args: Parameters<History['pushState']>) {
    const r = origPush.apply(this, args);
    fire();
    return r;
  };
  const replace = function (this: History, ...args: Parameters<History['replaceState']>) {
    const r = origReplace.apply(this, args);
    fire();
    return r;
  };
  history.pushState = push;
  history.replaceState = replace;
  win.addEventListener('popstate', fire);
  win.addEventListener('hashchange', fire);
  return () => {
    active = false;
    win.removeEventListener('popstate', fire);
    win.removeEventListener('hashchange', fire);
    if (history.pushState === push) history.pushState = origPush;
    if (history.replaceState === replace) history.replaceState = origReplace;
  };
}
