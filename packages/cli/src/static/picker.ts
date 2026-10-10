import readline from "node:readline";
import type { Readable } from "node:stream";

/**
 * Selector interactivo sin dependencias (readline + modo raw). La E/S se inyecta para
 * poder probarlo con streams simulados. Ctrl+C / Esc cancelan devolviendo null: siempre
 * restaura el modo del terminal y pausa stdin, para que el proceso pueda salir.
 */
export interface PickerInput extends Readable {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
}
export interface PickerOutput {
  write: (s: string) => unknown;
}
export interface PickerIo {
  input: PickerInput;
  output: PickerOutput;
  signal?: AbortSignal | undefined;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

const WINDOW = 12;

/** Escucha teclas hasta que `onKey` devuelva un valor distinto de undefined; null si se aborta. */
function withKeys<T>(io: PickerIo, onKey: (str: string | undefined, key: Key) => T | undefined, onStart?: () => void): Promise<T | null> {
  const { input } = io;
  return new Promise<T | null>((resolve) => {
    readline.emitKeypressEvents(input);
    const wasRaw = Boolean((input as { isRaw?: boolean }).isRaw);
    if (input.isTTY && input.setRawMode) input.setRawMode(true);
    let done = false;
    const finish = (v: T | null): void => {
      if (done) return;
      done = true;
      input.off("keypress", handler);
      input.off("end", onEnd);
      io.signal?.removeEventListener("abort", onAbort);
      if (input.isTTY && input.setRawMode) input.setRawMode(wasRaw);
      input.pause();
      resolve(v);
    };
    const handler = (str: string | undefined, key: Key | undefined): void => {
      const k = key ?? {};
      if ((k.ctrl && k.name === "c") || k.name === "escape") return finish(null);
      const r = onKey(str, k);
      if (r !== undefined) finish(r);
    };
    const onEnd = (): void => finish(null);
    const onAbort = (): void => finish(null);
    input.on("keypress", handler);
    input.once("end", onEnd);
    if (io.signal?.aborted) return finish(null);
    io.signal?.addEventListener("abort", onAbort, { once: true });
    onStart?.();
    input.resume();
  });
}

/** Lista numerada; flechas o numero para moverse, Enter confirma. Devuelve la pagina o null si se cancela. */
export async function pickPage(pages: string[], io: PickerIo, title = "Elige la pagina a abrir:"): Promise<string | null> {
  if (pages.length === 0) return null;
  const out = io.output;
  let sel = 0;
  let digits = "";
  let drawn = 0;
  const width = String(pages.length).length;

  const render = (): void => {
    const start = Math.max(0, Math.min(sel - Math.floor(WINDOW / 2), pages.length - WINDOW));
    const end = Math.min(pages.length, start + WINDOW);
    const lines = [title + "  (flechas o numero, Enter confirma, Ctrl+C cancela)"];
    if (start > 0) lines.push(`   ... ${start} mas arriba`);
    for (let i = start; i < end; i++) lines.push(`${i === sel ? ">" : " "} ${String(i + 1).padStart(width)}) ${pages[i]}`);
    if (end < pages.length) lines.push(`   ... ${pages.length - end} mas abajo`);
    if (drawn > 0) out.write(`\u001b[${drawn}A\r\u001b[J`);
    out.write(lines.join("\n") + "\n");
    drawn = lines.length;
  };

  const choice = await withKeys<string>(
    io,
    (str, key) => {
      if (key.name === "return" || key.name === "enter") return pages[sel] as string;
      if (key.name === "up" || key.name === "k") {
        digits = "";
        sel = (sel - 1 + pages.length) % pages.length;
      } else if (key.name === "down" || key.name === "j") {
        digits = "";
        sel = (sel + 1) % pages.length;
      } else if (key.name === "home") {
        digits = "";
        sel = 0;
      } else if (key.name === "end") {
        digits = "";
        sel = pages.length - 1;
      } else if (key.name === "backspace") {
        digits = digits.slice(0, -1);
        const n = Number(digits);
        if (n >= 1 && n <= pages.length) sel = n - 1;
      } else if (str !== undefined && /^[0-9]$/.test(str)) {
        let next = digits + str;
        if (Number(next) < 1 || Number(next) > pages.length) next = str; // reinicia con el digito nuevo
        digits = next;
        const n = Number(digits);
        if (n >= 1 && n <= pages.length) sel = n - 1;
      } else {
        return undefined;
      }
      render();
      return undefined;
    },
    render,
  );
  out.write(choice === null ? "Cancelado.\n" : `Seleccionada: ${choice}\n`);
  return choice;
}

/** Pregunta s/N con una sola tecla. Devuelve null si se cancela (Ctrl+C / Esc). Enter = No. */
export async function confirmKey(question: string, io: PickerIo): Promise<boolean | null> {
  io.output.write(`${question} [s/N] `);
  const r = await withKeys<boolean>(io, (str, key) => {
    const c = (str ?? "").toLowerCase();
    if (c === "s" || c === "y") return true;
    if (c === "n" || key.name === "return" || key.name === "enter") return false;
    return undefined;
  });
  io.output.write(r === null ? "\n" : r ? "s\n" : "n\n");
  return r;
}
