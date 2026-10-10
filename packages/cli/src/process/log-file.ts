import fs from "node:fs";
import { stripAnsi } from "./url";

export const MAX_READ_BYTES = 64 * 1024;

/** Lee como maximo `maxBytes` finales del archivo (captura limitada). */
export function readTail(file: string, maxBytes = MAX_READ_BYTES): string {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return "";
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Lee desde `offset` hasta `maxBytes`; devuelve texto y nuevo offset. */
export function readFrom(file: string, offset: number, maxBytes = MAX_READ_BYTES): { text: string; offset: number } {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { text: "", offset };
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(Math.max(0, size - offset), maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    return { text: buf.toString("utf8"), offset: offset + len };
  } finally {
    fs.closeSync(fd);
  }
}

export function tailLines(file: string, lines: number): string[] {
  const all = stripAnsi(readTail(file)).split(/\r?\n/);
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  return all.slice(-Math.max(1, lines));
}
