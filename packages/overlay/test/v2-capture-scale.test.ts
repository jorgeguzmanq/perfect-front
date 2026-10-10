import { describe, expect, it } from 'vitest';
import {
  CAPTURE_SCALES,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_SIDE,
  scaleOptions,
  scaleOptionsForEach,
  shotName,
  formatSize,
  unionBox,
} from '../src/capture-scale';

const SIDE = 'Pasa de 16 384 px por lado';
const PIXELS = 'Demasiados píxeles para renderizarse';

describe('constantes de captura', () => {
  it('escalas 1×–4× y máximos reales', () => {
    expect([...CAPTURE_SCALES]).toEqual([1, 2, 3, 4]);
    expect(MAX_CAPTURE_SIDE).toBe(16384);
    expect(MAX_CAPTURE_PIXELS).toBe(100_000_000);
  });
});

describe('scaleOptions', () => {
  it('nodo pequeño (496×136): las 4 escalas habilitadas con tamaño real', () => {
    expect(scaleOptions(496, 136)).toEqual([
      { scale: 1, width: 496, height: 136, enabled: true },
      { scale: 2, width: 992, height: 272, enabled: true },
      { scale: 3, width: 1488, height: 408, enabled: true },
      { scale: 4, width: 1984, height: 544, enabled: true },
    ]);
  });

  it('dimensiones fraccionarias se redondean hacia arriba y el mínimo es 1 px', () => {
    const opts = scaleOptions(0, 2.1);
    expect(opts[0]).toEqual({ scale: 1, width: 1, height: 3, enabled: true });
    expect(opts[3]).toEqual({ scale: 4, width: 4, height: 12, enabled: true });
  });

  it('exceder el máximo por lado deshabilita solo esa escala, con motivo', () => {
    // 5000×100: 3× = 15000 (ok), 4× = 20000 > 16384.
    const opts = scaleOptions(5000, 100);
    expect(opts.slice(0, 3).every((o) => o.enabled && o.reason === undefined)).toBe(true);
    expect(opts[2]).toEqual({ scale: 3, width: 15000, height: 300, enabled: true });
    expect(opts[3]).toEqual({ scale: 4, width: 20000, height: 400, enabled: false, reason: SIDE });
  });

  it('el límite por lado es inclusive: 4096 px × 4 = 16384 sigue habilitado', () => {
    const opts = scaleOptions(4096, 10);
    expect(opts[3]).toEqual({ scale: 4, width: 16384, height: 40, enabled: true });
  });

  it('exceder el área máxima (100 M px) deshabilita con motivo de píxeles', () => {
    // 3000×3000: 3× = 9000×9000 = 81 M (ok); 4× = 12000×12000 = 144 M (> 100 M), lados válidos.
    const opts = scaleOptions(3000, 3000);
    expect(opts[2]).toEqual({ scale: 3, width: 9000, height: 9000, enabled: true });
    expect(opts[3]).toEqual({ scale: 4, width: 12000, height: 12000, enabled: false, reason: PIXELS });
  });

  it('nodo enorme (9000×9000): solo 1× queda habilitada', () => {
    // 1× = 81 M px (ok); 2× = 18000 > 16384 por lado.
    const opts = scaleOptions(9000, 9000);
    expect(opts[0]).toEqual({ scale: 1, width: 9000, height: 9000, enabled: true });
    expect(opts.slice(1).map((o) => o.enabled)).toEqual([false, false, false]);
    expect(opts[1]!.reason).toBe(SIDE);
  });

  it('nodo aún mayor (20000×20000): ninguna escala habilitada', () => {
    const opts = scaleOptions(20000, 20000);
    expect(opts.every((o) => !o.enabled)).toBe(true);
    expect(opts[0]).toEqual({ scale: 1, width: 20000, height: 20000, enabled: false, reason: SIDE });
  });

  it('acepta un máximo por lado personalizado', () => {
    const opts = scaleOptions(100, 100, 150);
    expect(opts[0]).toEqual({ scale: 1, width: 100, height: 100, enabled: true });
    expect(opts[1]).toEqual({
      scale: 2,
      width: 200,
      height: 200,
      enabled: false,
      reason: 'Pasa de 150 px por lado',
    });
  });

  it('acepta un subconjunto de escalas', () => {
    expect(scaleOptions(10, 10, MAX_CAPTURE_SIDE, [1, 4])).toEqual([
      { scale: 1, width: 10, height: 10, enabled: true },
      { scale: 4, width: 40, height: 40, enabled: true },
    ]);
  });
});

describe('scaleOptionsForEach', () => {
  it('muestra el tamaño del nodo más grande y deshabilita una escala si otro nodo la excede', () => {
    // Más grande por área: 6000×2000 (12 M). El otro, 1000×9000 (9 M).
    // 2×: el pequeño da 2000×18000 (> 16384) -> deshabilita; el grande da 12000×4000 (ok).
    const opts = scaleOptionsForEach([
      { width: 1000, height: 9000 },
      { width: 6000, height: 2000 },
    ]);
    expect(opts[0]).toEqual({ scale: 1, width: 6000, height: 2000, enabled: true });
    expect(opts[1]).toEqual({ scale: 2, width: 12000, height: 4000, enabled: false, reason: SIDE });
  });

  it('nodos por separado: el tamaño mostrado es el del mayor y su motivo de área aplica', () => {
    // Mayor: 3000×3000. Otros dos caben. 4× del mayor excede el área.
    const opts = scaleOptionsForEach([
      { width: 100, height: 50 },
      { width: 3000, height: 3000 },
      { width: 200, height: 200 },
    ]);
    expect(opts.map((o) => [o.width, o.height, o.enabled])).toEqual([
      [3000, 3000, true],
      [6000, 6000, true],
      [9000, 9000, true],
      [12000, 12000, false],
    ]);
    expect(opts[3]!.reason).toBe(PIXELS);
  });

  it('con un solo nodo equivale a scaleOptions', () => {
    expect(scaleOptionsForEach([{ width: 496, height: 136 }])).toEqual(scaleOptions(496, 136));
  });

  it('sin nodos devuelve las opciones de un nodo de 1×1', () => {
    expect(scaleOptionsForEach([])).toEqual(scaleOptions(1, 1));
  });
});

describe('unionBox', () => {
  it('caja que contiene a todas las cajas (juntas)', () => {
    // l = min(10, -5) = -5; t = min(20, 40) = 20; r = max(110, 25) = 110; b = max(70, 240) = 240.
    expect(
      unionBox([
        { left: 10, top: 20, width: 100, height: 50 },
        { left: -5, top: 40, width: 30, height: 200 },
      ]),
    ).toEqual({ left: -5, top: 20, width: 115, height: 220 });
  });

  it('una sola caja se devuelve tal cual', () => {
    expect(unionBox([{ left: 3, top: 4, width: 5, height: 6 }])).toEqual({ left: 3, top: 4, width: 5, height: 6 });
  });

  it('sin cajas devuelve null', () => {
    expect(unionBox([])).toBeNull();
  });
});

describe('shotName', () => {
  it('nombre de archivo con escala y extensión png por defecto', () => {
    expect(shotName('Button CTA', 2)).toBe('nodo-button-cta@2x.png');
  });

  it('extensión personalizada', () => {
    expect(shotName('Hero', 3, 'jpg')).toBe('nodo-hero@3x.jpg');
  });

  it('caracteres no válidos se convierten en guion; sin nada útil usa «nodo»', () => {
    expect(shotName('  Título ñ  ', 1)).toBe('nodo-t-tulo@1x.png');
    expect(shotName('¡¡', 1)).toBe('nodo-nodo@1x.png');
  });

  it('la parte del nombre se recorta a 40 caracteres', () => {
    expect(shotName('a'.repeat(50), 4)).toBe(`nodo-${'a'.repeat(40)}@4x.png`);
  });
});

describe('formatSize', () => {
  it('ancho×alto con signo ×', () => {
    expect(formatSize({ width: 496, height: 136 })).toBe('496×136');
  });

  it('separa miles con espacio', () => {
    expect(formatSize({ width: 16384, height: 1000 })).toBe('16 384×1 000');
    expect(formatSize({ width: 1984, height: 544 })).toBe('1 984×544');
  });
});
