import { describe, expect, it } from 'vitest';
import { spacingKey, tailwindEquivalent, usesTailwind } from '../src/design/equivalent';

describe('equivalent: clase Tailwind informativa', () => {
  it('detecta si el elemento usa Tailwind', () => {
    expect(usesTailwind('flex items-center p-4')).toBe(true);
    expect(usesTailwind('card card--big')).toBe(false);
    expect(usesTailwind('')).toBe(false);
  });

  it('px a escala o valor arbitrario', () => {
    expect(spacingKey('16px')).toBe('4');
    expect(spacingKey('-8px')).toBe('-2');
    expect(spacingKey('13px')).toBe('[13px]');
    expect(spacingKey('auto')).toBe('auto');
  });

  it('espaciado por lado desdobla la forma corta', () => {
    expect(tailwindEquivalent('p-4', 'padding-top', '8px')).toBe('p-4 → px-4 pt-2 pb-4');
    expect(tailwindEquivalent('px-3', 'padding-left', '16px')).toBe('px-3 → pl-4 pr-3');
  });

  it('enums, tamaño, peso, radio y opacidad', () => {
    expect(tailwindEquivalent('flex flex-row', 'flex-direction', 'column')).toBe('flex-row → flex-col');
    expect(tailwindEquivalent('block', 'display', 'none')).toBe('block → hidden');
    expect(tailwindEquivalent('text-sm', 'font-size', '24px')).toBe('text-sm → text-2xl');
    expect(tailwindEquivalent('text-sm', 'font-size', '15px')).toBe('text-sm → text-[15px]');
    expect(tailwindEquivalent('font-normal', 'font-weight', '700')).toBe('font-normal → font-bold');
    expect(tailwindEquivalent('rounded-md', 'border-radius', '9999px')).toBe('rounded-md → rounded-full');
    expect(tailwindEquivalent('flex', 'opacity', '0.5')).toBe('— → opacity-50');
    expect(tailwindEquivalent('flex', 'justify-content', 'space-between')).toBe('— → justify-between');
  });

  it('color como valor arbitrario; null si no hay cambio o no se sabe representar', () => {
    expect(tailwindEquivalent('text-primary', 'color', '#2f5bea')).toBe('text-primary → text-[#2f5bea]');
    expect(tailwindEquivalent('flex', 'display', 'flex')).toBeNull();
    expect(tailwindEquivalent('flex', 'letter-spacing', '2px')).toBeNull();
  });
});
