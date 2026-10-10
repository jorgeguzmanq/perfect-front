import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { OFFICIAL_EXTENSION_ID } from "@perfect-front/shared";
import { createCore, type Core, type CoreOptions } from "../src/app";
import type { ProcessController, ProcessInfo, ProcessTarget, StopOutcome } from "../src/process/controller";

export const PORT = 45800;
export const BASE = `http://127.0.0.1:${PORT}`;
export const EXT_ID = OFFICIAL_EXTENSION_ID;
/** Origen de la extensión oficial: accede sin token. */
export const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
/** Extensión ajena (ni oficial ni configurada). */
export const FOREIGN_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";
export const FOREIGN_ORIGIN = `chrome-extension://${FOREIGN_ID}`;
/** ID de desarrollo válido, para probar PF_EXTENSION_IDS / extensionIds. */
export const DEV_ID = "abcdefghijklmnopabcdefghijklmnop";
export const DEV_ORIGIN = `chrome-extension://${DEV_ID}`;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
export const onCleanup = (fn: () => Promise<void> | void): void => void cleanups.push(fn);

export async function tmpDir(prefix = "pf-ls-"): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  onCleanup(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export class FakeProcessController implements ProcessController {
  calls: string[] = [];
  info: ProcessInfo = { state: "stopped", managed: false, url: null, pid: null };
  logLines: string[] = [];
  failStart = false;
  async status(t: ProcessTarget): Promise<ProcessInfo> {
    this.calls.push(`status:${t.root}`);
    return this.info;
  }
  async start(t: ProcessTarget): Promise<ProcessInfo> {
    this.calls.push(`start:${t.root}`);
    if (this.failStart) throw new Error("boom C:/Users/jorge/secret/path");
    this.info = { state: "running", managed: true, url: "http://localhost:5173", pid: 4242 };
    return this.info;
  }
  async stop(t: ProcessTarget): Promise<StopOutcome> {
    this.calls.push(`stop:${t.root}`);
    const had = this.info.state === "running";
    this.info = { state: "stopped", managed: false, url: null, pid: null };
    return had ? { outcome: "stopped", pid: 4242 } : { outcome: "none" };
  }
  async logs(_t: ProcessTarget, lines: number): Promise<string[] | null> {
    return this.logLines.slice(-lines);
  }
}

export interface Harness {
  core: Core;
  stateDir: string;
  projectRoot: string;
  controller: FakeProcessController;
  token: string;
  cliToken: string;
  req(p: string, init?: ReqInit): Response | Promise<Response>;
  json(p: string, init?: ReqInit): Promise<{ status: number; body: any }>;
  register(): Promise<string>;
}

export interface ReqInit {
  method?: string;
  body?: unknown;
  raw?: string;
  auth?: "session" | "cli" | "none" | string;
  headers?: Record<string, string>;
}

export async function makeHarness(opts: Partial<CoreOptions> & { stateDir?: string; projectRoot?: string } = {}): Promise<Harness> {
  const stateDir = opts.stateDir ?? (await tmpDir("pf-state-"));
  const projectRoot = opts.projectRoot ?? (await tmpDir("pf-proj-"));
  const controller = new FakeProcessController();
  const core = await createCore({
    processController: controller,
    getPort: () => PORT,
    ...opts,
    stateDir,
  });
  onCleanup(() => core.close());
  const h: Harness = {
    core,
    stateDir,
    projectRoot,
    controller,
    token: core.token,
    cliToken: core.cliToken,
    req(p, init = {}) {
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      const auth = init.auth ?? "session";
      if (auth === "session") headers.authorization = `Bearer ${core.token}`;
      else if (auth === "cli") headers.authorization = `Bearer ${core.cliToken}`;
      else if (auth !== "none") headers.authorization = `Bearer ${auth}`;
      let body: string | undefined = init.raw;
      if (init.body !== undefined) {
        body = JSON.stringify(init.body);
        headers["content-type"] ??= "application/json";
      }
      const url = p.startsWith("http") ? p : `${BASE}${p}`;
      return core.app.request(url, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, ...(body !== undefined ? { body } : {}) });
    },
    async json(p, init) {
      const res = await h.req(p, init);
      return { status: res.status, body: await res.json() };
    },
    async register() {
      const r = await h.json("/api/projects/register", { auth: "cli", body: { root: projectRoot } });
      if (r.status !== 201) throw new Error(`register failed ${r.status}`);
      return r.body.project.id as string;
    },
  };
  return h;
}

export function commentInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    scope: "element",
    comment: "Este botón debe ocupar todo el ancho.",
    location: {
      url: "http://localhost:5173/pricing",
      route: "/pricing",
      title: "Precios",
      selector: "main button.buy",
      selectorCandidates: ["main button.buy"],
      text: "Comprar",
      html: "<button>Comprar</button>",
      componentHint: null,
    },
    viewport: { width: 390, height: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    elementRect: { x: 1, y: 2, width: 3, height: 4 },
    environment: { framework: "vite-react", browser: "Chrome", colorScheme: "dark" },
    ...over,
  };
}

/** Cliente SSE acumulativo con timeout; close() cancela el stream. */
export class SseClient {
  text = '';
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private dec = new TextDecoder();
  constructor(res: Response) {
    this.reader = res.body!.getReader();
    onCleanup(() => this.close());
  }
  async waitFor(pred: (text: string) => boolean, ms = 3000): Promise<string> {
    const deadline = Date.now() + ms;
    while (!pred(this.text)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('SSE timeout; got: ' + this.text);
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('SSE timeout; got: ' + this.text)), left)),
      ]);
      if (chunk.done) break;
      this.text += this.dec.decode(chunk.value);
    }
    return this.text;
  }
  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}
