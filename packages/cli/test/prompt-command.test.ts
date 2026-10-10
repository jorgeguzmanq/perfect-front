import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPromptBlock, PROMPT_BEGIN, PROMPT_END } from "../src/agent-prompt";
import { stopManaged } from "../src/process";
import { readState } from "../src/process/state";
import { runCli } from "../src/run";
import { runPromptCommand } from "../src/prompt-command";

// Sin servidor ni navegador: solo proyectos temporales. No se usa --copy (tocaria el portapapeles real).

const SERVER = `
import http from "node:http";
const prefer = Number(process.argv[2] || 0);
const srv = http.createServer((_, res) => res.end("ok"));
const announce = () => console.log("  \\x1b[32m➜\\x1b[39m  Local:   http://localhost:" + srv.address().port + "/");
srv.once("error", () => srv.listen(0, announce));
srv.listen(prefer, announce);
`;

let dirs: string[] = [];
let servers: http.Server[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pf-prompt-"));
  dirs.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", scripts: { dev: "node server.mjs" } }));
  fs.mkdirSync(path.join(root, ".perfect-front"));
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  return root;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd, localServer: false });
  return { code, stdout, stderr };
}

async function runP(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await runPromptCommand(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), cwd });
  return { code, stdout, stderr };
}

const json = (s: string) => JSON.parse(s.trim());

beforeEach(() => {
  dirs = [];
  servers = [];
});

afterEach(async () => {
  for (const d of dirs) {
    const st = readState(d);
    if (st) await stopManaged({ root: d, url: null });
  }
  for (const s of servers) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("subcomando prompt (alias agent-prompt)", () => {
  it("imprime el bloque delimitado con rutas reales, sin servidor", async () => {
    const root = makeProject();
    const r = await run(["prompt"], root);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith(PROMPT_BEGIN + "\n")).toBe(true);
    expect(r.stdout).toContain(PROMPT_END);
    expect(r.stdout).toContain(`Raíz del proyecto: ${path.resolve(root)}`);
    expect(r.stdout).toContain("no disponible (el dev server no está activo");
    expect(r.stderr).toBe("");
  });

  it("el alias agent-prompt produce la misma salida", async () => {
    const root = makeProject();
    const a = await run(["prompt"], root);
    const b = await run(["agent-prompt"], root);
    expect(b.code).toBe(0);
    expect(b.stdout).toBe(a.stdout);
  });

  it("el bloque humano coincide con formatPromptBlock del JSON", async () => {
    const root = makeProject();
    const human = await run(["prompt"], root);
    const data = json((await run(["prompt", "--json"], root)).stdout);
    expect(human.stdout).toBe(formatPromptBlock(data.agentPrompt) + "\n");
  });

  it("--project resuelve la raíz desde una subcarpeta y --cwd desde otro directorio", async () => {
    const root = makeProject();
    const viaProject = await runP(["prompt", "--project", path.join(root, "src", "deep"), "--json"], os.tmpdir());
    expect(viaProject.code).toBe(0);
    expect(path.resolve(json(viaProject.stdout).root)).toBe(path.resolve(root));

    const viaCwd = await runP(["prompt", "--cwd", root, "--json"], os.tmpdir());
    expect(viaCwd.code).toBe(0);
    expect(path.resolve(json(viaCwd.stdout).root)).toBe(path.resolve(root));
  });

  it("--project relativo se resuelve contra el directorio actual", async () => {
    const root = makeProject();
    const r = await runP(["prompt", "--project", "src", "--json"], root);
    expect(r.code).toBe(0);
    expect(path.resolve(json(r.stdout).root)).toBe(path.resolve(root));
  });

  it("--json deja stdout como un único objeto JSON válido con agentPrompt", async () => {
    const root = makeProject();
    const r = await runP(["prompt", "--json"], root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const data = json(r.stdout);
    expect(data).toMatchObject({ ok: true, command: "prompt", url: null, targetUrl: null, copied: false });
    expect(data.agentPrompt).toContain("Eres un agente de código");
    expect(data.agentPrompt).toContain(`Datos de Perfect Front: ${path.join(path.resolve(root), ".perfect-front")}`);
    expect(data.agentPrompt).not.toContain(PROMPT_BEGIN);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("sin proyecto devuelve 3 (y JSON de error con --json)", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pf-prompt-empty-"));
    dirs.push(empty);
    const human = await runP(["prompt"], empty);
    expect(human.code).toBe(3);
    expect(human.stderr).toContain("Error:");
    const js = await runP(["prompt", "--json"], empty);
    expect(js.code).toBe(3);
    expect(json(js.stdout)).toMatchObject({ ok: false, error: { code: "project_not_found" } });
  });

  it("argumentos inválidos devuelven 2", async () => {
    const root = makeProject();
    expect((await runP(["prompt", "--bogus", "--json"], root)).code).toBe(2);
    expect(json((await runP(["prompt", "--bogus", "--json"], root)).stdout)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect((await runP(["prompt", "extra", "otro"], root)).code).toBe(2);
  });

  it("--help imprime la ayuda y sale con 0", async () => {
    const r = await runP(["prompt", "--help"], os.tmpdir());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("perfect-front prompt");
  });
});

describe("arranque: --no-agent-prompt y campo agentPrompt", () => {
  const fixture = (): { root: string; cmd: string } => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "server.mjs"), SERVER);
    return { root, cmd: "node server.mjs 0" };
  };

  const freeUrl = async (): Promise<string> => {
    const srv = http.createServer((_, res) => res.end("external"));
    servers.push(srv);
    const port = await new Promise<number>((resolve) => srv.listen(0, () => resolve((srv.address() as net.AddressInfo).port)));
    await new Promise((r) => srv.close(r));
    return `http://localhost:${port}/`;
  };

  it(
    "por defecto imprime el bloque tras el arranque; --no-agent-prompt lo omite",
    async () => {
      const { root, cmd } = fixture();
      const url = await freeUrl();
      const base = ["--command", cmd, "--url", url, "--no-open"];

      const withBlock = await run(["start", ...base], root);
      expect(withBlock.code).toBe(0);
      expect(withBlock.stdout).toContain(PROMPT_BEGIN);
      expect(withBlock.stdout).toContain(PROMPT_END);
      await stopManaged({ root, url: null });

      const without = await run(["start", ...base, "--no-agent-prompt"], root);
      expect(without.code).toBe(0);
      expect(without.stdout).not.toContain(PROMPT_BEGIN);
      expect(without.stdout).not.toContain(PROMPT_END);
      await stopManaged({ root, url: null });
    },
    30_000,
  );

  it(
    "--json incluye agentPrompt por defecto y lo omite con --no-agent-prompt; stdout es JSON válido",
    async () => {
      const { root, cmd } = fixture();
      const url = await freeUrl();
      const base = ["--command", cmd, "--url", url, "--json"];

      const withPrompt = await run(["start", ...base], root);
      expect(withPrompt.code).toBe(0);
      const data = json(withPrompt.stdout);
      expect(data.ok).toBe(true);
      expect(typeof data.agentPrompt).toBe("string");
      expect(data.agentPrompt).toContain(`Raíz del proyecto: ${path.resolve(root)}`);
      expect(data.agentPrompt).toContain("perfect-front list --json");
      expect(data.agentPrompt).not.toContain(PROMPT_BEGIN);
      await stopManaged({ root, url: null });

      const noPrompt = await run(["start", ...base, "--no-agent-prompt"], root);
      expect(noPrompt.code).toBe(0);
      const parsed = json(noPrompt.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed).not.toHaveProperty("agentPrompt");
      await stopManaged({ root, url: null });
    },
    30_000,
  );
});
