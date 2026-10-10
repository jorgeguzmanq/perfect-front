import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@perfect-front/shared';
import {
  Attachments,
  MAX_IMAGE_BYTES,
  formatBytes,
  hasFiles,
  imageFilesFrom,
} from '../src/attachments';

/** Archivo falso con la forma mínima que usa Attachments (evita depender de File/Blob del entorno). */
function fakeFile(name: string, type: string, bytes: number[] = [1, 2, 3, 4], size = bytes.length): File {
  return {
    name,
    type,
    size,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File;
}

const shot = (dataBase64 = 'AQIDBA==') => ({ mimeType: 'image/png' as const, dataBase64 });

let urlSeq = 0;
beforeEach(() => {
  urlSeq = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++urlSeq}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatBytes', () => {
  it('formatea en B, KB y MB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('Attachments: tope y bloqueo', () => {
  it('acepta hasta LIMITS.attachments (20) y bloquea la 21', () => {
    const a = new Attachments();
    for (let i = 0; i < LIMITS.attachments; i++) {
      expect(a.addCapture(shot(), null).ok).toBe(true);
    }
    expect(a.count).toBe(20);
    expect(a.full).toBe(true);
    expect(a.remaining).toBe(0);
    expect(a.counter).toBe('20 / 20');

    const r = a.addCapture(shot(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Máximo 20');
    expect(a.count).toBe(20);
  });

  it('el bloqueo también aplica a addFile (no solo a capturas)', async () => {
    const a = new Attachments();
    for (let i = 0; i < LIMITS.attachments; i++) a.addCapture(shot(), null);
    const r = await a.addFile(fakeFile('x.png', 'image/png'), 'paste');
    expect(r.ok).toBe(false);
    expect(a.count).toBe(LIMITS.attachments);
  });

  it('quitar una imagen libera un hueco para otra', () => {
    const a = new Attachments();
    for (let i = 0; i < LIMITS.attachments; i++) a.addCapture(shot(), null);
    const first = a.items[0]!.clientId;
    a.remove(first);
    expect(a.full).toBe(false);
    expect(a.addCapture(shot(), null).ok).toBe(true);
  });

  it('el tope de tamaño total de subidas (uploadsBase64) rechaza con mensaje claro', () => {
    const a = new Attachments();
    const huge = 'A'.repeat(LIMITS.uploadsBase64 + 1);
    const r = a.addCapture({ mimeType: 'image/png', dataBase64: huge }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('demasiado grandes');
    expect(a.count).toBe(0);
  });
});

describe('Attachments: validación de archivos', () => {
  it('rechaza GIF y otros tipos que no son PNG/JPG/WebP', async () => {
    const a = new Attachments();
    const r = await a.addFile(fakeFile('anim.gif', 'image/gif'), 'drop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no es una imagen');
    expect(a.count).toBe(0);
  });

  it('acepta PNG, JPEG y WebP', async () => {
    const a = new Attachments();
    for (const t of ['image/png', 'image/jpeg', 'image/webp']) {
      expect((await a.addFile(fakeFile('f', t), 'open')).ok).toBe(true);
    }
    expect(a.count).toBe(3);
  });

  it('rechaza archivos por encima de 5 MB y acepta exactamente 5 MB', async () => {
    const a = new Attachments();
    const over = await a.addFile(fakeFile('grande.png', 'image/png', [1], MAX_IMAGE_BYTES + 1), 'paste');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain('5 MB');

    const exact = await a.addFile(fakeFile('justo.png', 'image/png', [1], MAX_IMAGE_BYTES), 'paste');
    expect(exact.ok).toBe(true);
  });

  it('codifica el contenido en base64 y registra origen, tamaño y sección', async () => {
    const a = new Attachments();
    const r = await a.addFile(fakeFile('foto.png', 'image/png', [1, 2, 3, 4]), 'paste', 'sec-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image).toMatchObject({
      name: 'foto.png',
      source: 'paste',
      mimeType: 'image/png',
      bytes: 4,
      dataBase64: 'AQIDBA==',
      sectionId: 'sec-1',
      previewUrl: 'blob:test-1',
    });
    expect(r.image.clientId.startsWith('img-')).toBe(true);
  });

  it('el nombre queda reducido a su basename y sin caracteres de control', async () => {
    const a = new Attachments();
    const r = await a.addFile(fakeFile('C:\\Users\\jorge\\pantallazo.png', 'image/png'), 'drop');
    expect(r.ok && r.image.name).toBe('pantallazo.png');

    const r2 = await a.addFile(fakeFile('', 'image/jpeg'), 'drop');
    expect(r2.ok && r2.image.name).toBe('imagen.jpg');
  });

  it('addFiles devuelve los errores acumulados y suma las válidas', async () => {
    const a = new Attachments();
    const errors = await a.addFiles(
      [fakeFile('ok.png', 'image/png'), fakeFile('x.gif', 'image/gif'), fakeFile('y.webp', 'image/webp')],
      'drop',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no es una imagen');
    expect(a.count).toBe(2);
  });
});

describe('Attachments: reubicar entre secciones', () => {
  it('moveTo cambia la sección y notifica el cambio', () => {
    const onChange = vi.fn();
    const a = new Attachments({ onChange });
    a.addCapture(shot(), 'sec-1');
    const id = a.items[0]!.clientId;
    onChange.mockClear();

    a.moveTo(id, 'sec-2');
    expect(a.items[0]!.sectionId).toBe('sec-2');
    expect(a.inSection('sec-2')).toHaveLength(1);
    expect(a.inSection('sec-1')).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('moveTo a null la deja suelta; a la misma sección no notifica', () => {
    const onChange = vi.fn();
    const a = new Attachments({ onChange });
    a.addCapture(shot(), 'sec-1');
    const id = a.items[0]!.clientId;
    onChange.mockClear();

    a.moveTo(id, 'sec-1');
    expect(onChange).not.toHaveBeenCalled();

    a.moveTo(id, null);
    expect(a.inSection(null)).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('moveTo con un clientId inexistente no hace nada', () => {
    const a = new Attachments();
    a.addCapture(shot(), null);
    expect(() => a.moveTo('img-nope', 'sec-1')).not.toThrow();
    expect(a.inSection('sec-1')).toHaveLength(0);
  });

  it('releaseSection deja sueltas las imágenes de esa sección sin perderlas', () => {
    const a = new Attachments();
    a.addCapture(shot(), 'sec-1');
    a.addCapture(shot(), 'sec-1');
    a.addCapture(shot(), 'sec-2');
    a.releaseSection('sec-1');
    expect(a.count).toBe(3);
    expect(a.inSection(null)).toHaveLength(2);
    expect(a.inSection('sec-2')).toHaveLength(1);
  });

  it('toUploads expone sectionId y clientId para la request', () => {
    const a = new Attachments();
    a.addCapture(shot('AQIDBA=='), 'sec-9');
    const [u] = a.toUploads();
    expect(u).toMatchObject({ source: 'capture', sectionId: 'sec-9', mimeType: 'image/png', dataBase64: 'AQIDBA==' });
    expect(u!.name).toBe('captura.png');
    expect(u!.clientId).toBe(a.items[0]!.clientId);
  });
});

describe('Attachments: quitar y liberar memoria', () => {
  it('remove revoca la URL blob y descuenta del tope de caracteres', async () => {
    const a = new Attachments();
    const r = await a.addFile(fakeFile('a.png', 'image/png'), 'paste');
    if (!r.ok) throw new Error('setup');
    a.remove(r.image.clientId);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
    expect(a.count).toBe(0);
  });

  it('remove con id desconocido no notifica ni cambia nada', () => {
    const onChange = vi.fn();
    const a = new Attachments({ onChange });
    a.remove('img-nope');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clear vacía la lista y revoca las URLs blob', async () => {
    const a = new Attachments();
    await a.addFile(fakeFile('a.png', 'image/png'), 'paste');
    await a.addFile(fakeFile('b.png', 'image/png'), 'paste');
    a.clear();
    expect(a.count).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('imageFilesFrom / hasFiles', () => {
  const img = fakeFile('a.png', 'image/png');
  const txt = fakeFile('b.txt', 'text/plain');

  it('toma solo imágenes de dt.items', () => {
    const dt = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => img },
        { kind: 'file', type: 'application/pdf', getAsFile: () => txt },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(imageFilesFrom(dt)).toEqual([img]);
  });

  it('si items no trae imágenes, cae a dt.files filtrando por image/', () => {
    const dt = { items: [], files: [txt, img] } as unknown as DataTransfer;
    expect(imageFilesFrom(dt)).toEqual([img]);
  });

  it('null o undefined devuelven lista vacía', () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });

  it('hasFiles detecta el tipo «Files» al arrastrar', () => {
    expect(hasFiles({ types: ['text/plain', 'Files'] } as unknown as DataTransfer)).toBe(true);
    expect(hasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });
});
