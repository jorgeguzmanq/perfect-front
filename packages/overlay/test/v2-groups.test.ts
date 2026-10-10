import { describe, expect, it } from 'vitest';
import { CommentGroupRefSchema, GroupIdSchema, LIMITS, type ReadingGroup } from '@perfect-front/shared';
import {
  bindingStep,
  groupBrief,
  groupRefForCreate,
  needsReorder,
  orderWithInserted,
  queueFor,
  slugGroupId,
  type GroupBinding,
  type QueueComment,
} from '../src/groups';

const q = (id: string, position?: number, group = 'grupo-a'): QueueComment => ({
  id,
  status: 'pending',
  comment: `Comentario ${id}`,
  scope: 'element',
  location: { route: '/', selector: `#${id}` },
  group: position === undefined ? null : { id: group, position },
});

describe('slugGroupId', () => {
  it('normaliza acentos, minúsculas y separadores', () => {
    expect(slugGroupId('Décor & Cañón!', new Set())).toBe('decor-canon');
  });

  it('nombre sin letras ni dígitos cae a «grupo»', () => {
    expect(slugGroupId('!!!', new Set())).toBe('grupo');
  });

  it('evita colisiones con ids existentes añadiendo sufijo numérico', () => {
    expect(slugGroupId('Hola', new Set(['hola']))).toBe('hola-2');
    expect(slugGroupId('Hola', new Set(['hola', 'hola-2']))).toBe('hola-3');
  });

  it('el resultado es un GroupId válido', () => {
    const id = slugGroupId('Checkout: pago con tarjeta', new Set());
    expect(GroupIdSchema.safeParse(id).success).toBe(true);
  });
});

describe('queueFor', () => {
  it('filtra por grupo y ordena por position', () => {
    const comments = [q('c', 2), q('a', 1), q('x', 1, 'otro'), q('b', 3)];
    expect(queueFor('grupo-a', comments).map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('comentarios sin grupo quedan fuera', () => {
    expect(queueFor('grupo-a', [q('a')])).toEqual([]);
  });
});

describe('bindingStep', () => {
  const queue = [q('a', 1), q('b', 2)];

  it('sin afterId va al final (paso = longitud + 1)', () => {
    const b: GroupBinding = { groupId: 'grupo-a', afterId: null };
    expect(bindingStep(b, queue)).toBe(3);
  });

  it('tras un comentario de la cola ocupa el paso siguiente a él', () => {
    expect(bindingStep({ groupId: 'grupo-a', afterId: 'a' }, queue)).toBe(2);
    expect(bindingStep({ groupId: 'grupo-a', afterId: 'b' }, queue)).toBe(3);
  });

  it('afterId inexistente cae al final', () => {
    expect(bindingStep({ groupId: 'grupo-a', afterId: 'zz' }, queue)).toBe(3);
  });
});

describe('groupRefForCreate', () => {
  it('la posición provisional es el final de la cola y pasa el schema de referencia', () => {
    const ref = groupRefForCreate({ groupId: 'grupo-a', afterId: null }, [q('a', 1), q('b', 2)]);
    expect(ref).toEqual({ id: 'grupo-a', position: 3 });
    expect(CommentGroupRefSchema.safeParse(ref).success).toBe(true);
  });

  it('la posición se acota a LIMITS.groupItems', () => {
    const full = Array.from({ length: LIMITS.groupItems }, (_, i) => q(`c${i}`, i + 1));
    expect(groupRefForCreate({ groupId: 'grupo-a', afterId: null }, full).position).toBe(LIMITS.groupItems);
  });
});

describe('orderWithInserted', () => {
  const queue = [q('a', 1), q('b', 2), q('c', 3)];

  it('inserta el nuevo tras afterId', () => {
    expect(orderWithInserted(queue, 'n', 'a')).toEqual(['a', 'n', 'b', 'c']);
  });

  it('sin afterId lo deja al final', () => {
    expect(orderWithInserted(queue, 'n', null)).toEqual(['a', 'b', 'c', 'n']);
  });

  it('si el id nuevo ya está en la cola, no se duplica', () => {
    expect(orderWithInserted(queue, 'b', 'a')).toEqual(['a', 'b', 'c']);
  });
});

describe('needsReorder', () => {
  const queue = [q('a', 1), q('b', 2)];

  it('no hace falta si va al final o no tiene afterId', () => {
    expect(needsReorder({ groupId: 'grupo-a', afterId: null }, queue)).toBe(false);
    expect(needsReorder({ groupId: 'grupo-a', afterId: 'b' }, queue)).toBe(false);
  });

  it('hace falta si se inserta en medio de la cola', () => {
    expect(needsReorder({ groupId: 'grupo-a', afterId: 'a' }, queue)).toBe(true);
  });

  it('con cola vacía no hace falta', () => {
    expect(needsReorder({ groupId: 'grupo-a', afterId: 'a' }, [])).toBe(false);
  });
});

describe('groupBrief', () => {
  const group = {
    id: 'grupo-a',
    name: 'Navegación',
    note: '  Revisar el menú móvil  ',
    readFirst: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  } as unknown as ReadingGroup;

  it('arma encabezado, nota, aviso de lectura y cola numerada', () => {
    const queue: QueueComment[] = [
      { ...q('a', 1), status: 'pending', comment: 'Cambiar   el color\n', location: { route: '/home', selector: '#btn' } },
      { ...q('b', 2), status: 'resolved', comment: 'Ok', location: { route: '/otra', selector: null } },
    ];
    const md = groupBrief(group, queue);
    expect(md.split('\n')).toEqual([
      '# Grupo grupo-a: Navegación',
      '',
      'Revisar el menú móvil',
      '',
      '> Lee la nota y toda la cola, en orden, antes de actuar.',
      '',
      '1. [pending] Cambiar el color (`#btn` en /home)',
      '2. [resolved] Ok (/otra)',
    ]);
  });

  it('sin nota ni readFirst omite esas líneas y escapa backticks del selector', () => {
    const plain = { ...group, note: '  ', readFirst: false } as ReadingGroup;
    const md = groupBrief(plain, [{ ...q('a', 1), location: { route: '/', selector: 'div`x`' } }]);
    expect(md).not.toContain('Lee la nota');
    expect(md).toContain("(`div'x'` en /)");
    expect(md.split('\n')[1]).toBe('');
    expect(md.split('\n')[2]).toMatch(/^1\. \[pending\]/);
  });
});
