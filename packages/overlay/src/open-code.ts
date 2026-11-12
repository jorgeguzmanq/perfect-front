import type { LocationSource } from '@perfect-front/shared';
import { parseSrc } from './dom';

/** «Abrir en el código»: el overlay solo manda `{file, line, column?}`; el servidor local abre el editor. */

export interface OpenTarget {
  file: string;
  line: number;
  column?: number;
}

/** Puerto de la API: lanza `Error` con el mensaje listo para mostrar si el servidor no pudo abrirlo. */
export interface OpenApi {
  open(target: OpenTarget): Promise<void>;
}

export const NO_SOURCE = 'Sin archivo de origen';
export const OPEN_LABEL = 'Abrir en el código';

export function targetFromSource(s: LocationSource | null | undefined): OpenTarget | null {
  if (!s?.file) return null;
  const t: OpenTarget = { file: s.file, line: s.line ?? 1 };
  if (typeof s.column === 'number') t.column = s.column;
  return t;
}

/** `archivo:línea[:col]` (data-pf-src) -> destino. */
export function targetFromSrc(src: string | null | undefined): OpenTarget | null {
  return targetFromSource(parseSrc(src));
}

const HINT_SRC = /\(([^()]+:\d+(?::\d+)?)\)\s*$/;

/** Destino de un comentario guardado: `location.source`, o el `(archivo:línea)` que añade el hint del componente. */
export function targetOfComment(c: { location: { source?: LocationSource | null; componentHint?: string | null } }): OpenTarget | null {
  const direct = targetFromSource(c.location.source);
  if (direct) return direct;
  const m = HINT_SRC.exec(c.location.componentHint ?? '');
  return m ? targetFromSrc(m[1]) : null;
}

/** Pide abrir el archivo y avisa del resultado. Nunca lanza. */
export async function openInCode(api: OpenApi, t: OpenTarget, say: (m: string) => void): Promise<boolean> {
  try {
    await api.open(t);
    say(`Abriendo ${t.file}:${t.line} en tu editor.`);
    return true;
  } catch (e) {
    say(e instanceof Error && e.message ? e.message : 'No se pudo abrir el archivo en el editor.');
    return false;
  }
}
