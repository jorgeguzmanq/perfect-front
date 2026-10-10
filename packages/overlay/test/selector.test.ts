// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { generateSelectorCandidates } from '../src/selector';
import { serializeElement, extractText } from '../src/context';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string) {
  document.body.innerHTML = html;
}

function expectUnique(el: Element) {
  const cands = generateSelectorCandidates(el);
  expect(cands.length).toBeGreaterThan(0);
  for (const c of cands) {
    const all = document.querySelectorAll(c);
    expect(all.length, c).toBe(1);
    expect(all[0], c).toBe(el);
  }
  return cands;
}

describe('selectores', () => {
  it('prioriza id estable sobre todo lo demás', () => {
    mount('<main><button id="buy" class="btn">Comprar</button><button class="btn">Otro</button></main>');
    const c = expectUnique(document.getElementById('buy')!);
    expect(c[0]).toBe('#buy');
  });

  it('prioriza data-testid sobre clases y nth-child', () => {
    mount('<ul><li><a data-testid="home-link" class="a">x</a></li><li><a class="a">y</a></li></ul>');
    const c = expectUnique(document.querySelector('[data-testid]')!);
    expect(c[0]).toBe('[data-testid="home-link"]');
  });

  it('ignora ids y clases generadas', () => {
    mount(
      '<div><p id=":r1:" class="css-1x2y3z4 Button_root__a1b2c3">a</p><p id="x1234567">b</p><p class="css-9f8e7d6">c</p></div>',
    );
    for (const p of Array.from(document.querySelectorAll('p'))) {
      const c = expectUnique(p);
      for (const s of c.slice(0, -1)) expect(s).not.toMatch(/css-|__a1b2c3|:r1:|x1234567/);
    }
  });

  it('usa atributos estables antes que posición', () => {
    mount('<form><input name="email"><input name="pass" type="password"></form>');
    const c = expectUnique(document.querySelector('input[name="pass"]')!);
    expect(c[0]).toBe('input[name="pass"]');
  });

  it('elementos idénticos se distinguen con ruta estructural y todos los candidatos son únicos', () => {
    mount('<section><div><span>a</span><span>a</span><span>a</span></div><div><span>a</span></div></section>');
    for (const s of Array.from(document.querySelectorAll('span'))) {
      const c = expectUnique(s);
      expect(c.some((x) => /nth-/.test(x))).toBe(true);
    }
  });

  it('anidados: cada nivel resuelve a su elemento', () => {
    mount('<div id="a"><div><div><p><b>t</b></p></div></div></div>');
    for (const el of Array.from(document.querySelectorAll('#a, #a *'))) expectUnique(el);
  });

  it('SVG y sus hijos', () => {
    mount(
      '<svg viewBox="0 0 10 10"><g><path d="M0 0"/><path d="M1 1"/><circle cx="1" cy="1" r="1"/></g></svg>',
    );
    for (const el of Array.from(document.querySelectorAll('svg, svg *'))) expectUnique(el);
  });

  it('enlaces, botones y formularios; escapa valores raros', () => {
    mount(
      '<a href="/x?y=1&z=&quot;q&quot;">l</a><button type="submit" aria-label="Enviar &quot;ya&quot;">b</button><form id="f"><select name="s"><option>1</option><option>2</option></select></form>',
    );
    for (const el of Array.from(document.querySelectorAll('a, button, form, select, option'))) expectUnique(el);
  });

  it('no incluye href javascript:', () => {
    mount('<a href="javascript:alert(1)">x</a><a href="/b">y</a>');
    const c = expectUnique(document.querySelector('a')!);
    expect(c.join('|')).not.toMatch(/javascript:/);
  });
});

describe('serialización', () => {
  it('es texto inerte: sin handlers, scripts ni valores; escapado y limitado', () => {
    mount(
      '<div id="r" onclick="alert(1)"><script>window.hacked=1</script><input value="secreto"><a href="javascript:alert(1)">x &lt;b&gt;</a></div>',
    );
    const html = serializeElement(document.getElementById('r')!);
    expect(html).not.toMatch(/onclick|hacked|secreto|javascript:/);
    expect(html).toContain('x &lt;b&gt;');
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('respeta el límite', () => {
    mount('<div id="r">' + '<p>hola mundo</p>'.repeat(5000) + '</div>');
    expect(serializeElement(document.getElementById('r')!, 500).length).toBeLessThanOrEqual(500);
    expect(extractText(document.getElementById('r')!, 100)!.length).toBeLessThanOrEqual(100);
  });
});
