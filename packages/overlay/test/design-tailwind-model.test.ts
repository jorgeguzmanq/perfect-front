import { describe, expect, it } from 'vitest';
import * as tw from '../src/design/tailwind-model';

const w = <V>(cls: string, variant: string, p: tw.TwProperty<V>, v: V) => tw.serializeTokens(tw.writeProp(tw.parseTokens(cls), variant, p, v));

describe('tailwind-model: tokens', () => {
  it('separa variantes y respeta ":" dentro de [] y el flag !', () => {
    const [a, b, c] = tw.parseTokens('dark:hover:bg-primary bg-[url(a:b)] !p-4');
    expect(a).toMatchObject({ variant: 'dark:hover', base: 'bg-primary' });
    expect(b).toMatchObject({ variant: '', base: 'bg-[url(a:b)]' });
    expect(c).toMatchObject({ variant: '', base: 'p-4', important: true });
  });

  it('serializa tal cual', () => {
    const s = 'flex  items-center md:p-2';
    expect(tw.serializeTokens(tw.parseTokens(s))).toBe('flex items-center md:p-2');
  });

  it('listStates incluye los habituales y los presentes', () => {
    const states = tw.listStates(tw.parseTokens('group-hover:flex'));
    expect(states[0]).toBe('');
    expect(states).toContain('md');
    expect(states).toContain('group-hover');
  });
});

describe('tailwind-model: propiedades por estado', () => {
  it('escribe en su estado sin tocar otros ni "otras clases"', () => {
    expect(w('flex btn hover:flex-col', '', tw.flexDirection, 'flex-col')).toBe('flex btn hover:flex-col flex-col');
    expect(w('flex-row btn hover:flex-row', '', tw.flexDirection, 'flex-col')).toBe('flex-col btn hover:flex-row');
    expect(w('p-2 hover:p-4', 'hover', tw.padding, { t: '8', r: '8', b: '8', l: '8' })).toBe('p-2 hover:p-8');
  });

  it('quitar (null) elimina el token y conserva el flag !', () => {
    expect(w('flex items-center', '', tw.alignItems, null)).toBe('flex');
    expect(w('!items-center', '', tw.alignItems, 'items-end')).toBe('!items-end');
  });

  it('padding: lee con precedencia y escribe la forma más compacta', () => {
    const t = tw.parseTokens('p-4 pt-2');
    expect(tw.readProp(t, '', tw.padding)).toEqual({ t: '2', r: '4', b: '4', l: '4' });
    expect(w('', '', tw.padding, { t: '4', r: '4', b: '4', l: '4' })).toBe('p-4');
    expect(w('', '', tw.padding, { t: '2', r: '3', b: '2', l: '3' })).toBe('px-3 py-2');
    expect(w('', '', tw.padding, { t: '1', r: null, b: null, l: null })).toBe('pt-1');
    expect(w('', '', tw.margin, { t: '-2', r: null, b: null, l: null })).toBe('-mt-2');
  });

  it('no confunde max-w/min-w con margen ni text-sm con color', () => {
    expect(tw.margin.match('max-w-md')).toBe(false);
    expect(tw.textColor.match('text-sm')).toBe(false);
    expect(tw.textColor.match('text-primary')).toBe(true);
    expect(tw.textColor.match('text-[#fff]/50')).toBe(true);
    expect(tw.gap.match('gap-x-2')).toBe(false);
  });

  it('color con opacidad', () => {
    const t = tw.parseTokens('bg-primary/50');
    expect(tw.readProp(t, '', tw.bgColor)).toEqual({ color: 'primary', opacity: '50' });
    expect(w('bg-primary/50', '', tw.bgColor, { color: 'secondary', opacity: null })).toBe('bg-secondary');
  });

  it('border y rounded usan DEFAULT/1 como la forma corta', () => {
    expect(tw.readProp(tw.parseTokens('border'), '', tw.borderWidth)).toBe('1');
    expect(w('', '', tw.rounded, 'DEFAULT')).toBe('rounded');
    expect(w('', '', tw.shadow, 'md')).toBe('shadow-md');
  });

  it('unclaimedTokens devuelve lo que ninguna sección modela', () => {
    expect(tw.unclaimedTokens(tw.parseTokens('flex btn-primary p-2 animate-spin'), '')).toEqual(['btn-primary', 'animate-spin']);
    expect(tw.sectionTokens(tw.parseTokens('flex p-2 text-lg'), '', 'spacing')).toEqual(['p-2']);
  });
});
