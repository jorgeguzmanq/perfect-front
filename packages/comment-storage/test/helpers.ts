import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { CommentStorage } from "../src/index";

const created: string[] = [];

/** Directorio temporal (con espacios en el nombre a propósito). */
export async function tempDir(prefix = "pf storage "): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function tempProject(): Promise<{ root: string; storage: CommentStorage }> {
  const root = await tempDir();
  return { root, storage: await CommentStorage.init(root) };
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop()!;
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }).catch(() => undefined);
  }
});

export function commentInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    scope: "element",
    comment: "Este botón debe ocupar todo el ancho en móvil.",
    location: {
      url: "http://localhost:5173/pricing",
      route: "/pricing",
      title: "Precios",
      selector: "main button.buy",
      selectorCandidates: ["main button.buy"],
      text: "Comprar",
      html: '<button class="buy">Comprar</button>',
      componentHint: null,
    },
    viewport: { width: 390, height: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    elementRect: { x: 20, y: 601, width: 350, height: 44 },
    environment: { framework: "vite-react", browser: "Chrome", colorScheme: "dark" },
    ...over,
  };
}

export const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

export async function listNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

export async function mkdirp(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
