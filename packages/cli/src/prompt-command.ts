import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { toErrorData } from "@perfect-front/shared";
import { buildAgentPrompt, formatPromptBlock } from "./agent-prompt";
import { COMMENT_EXIT, commentExitCode, locateRoot } from "./comments";
import { getStatus } from "./process";
import { swapOrigin } from "./proxy/host";
import { liveProxyState } from "./proxy/state";

/** `perfect-front prompt` (alias `agent-prompt`): reimprime el prompt para el agente; funciona sin servidor corriendo. */

export const PROMPT_COMMANDS = ["prompt", "agent-prompt"] as const;

export const PROMPT_HELP = `Prompt listo para pegar a un agente de codigo (Claude Code, Codex...) con los datos reales del proyecto

  perfect-front prompt [--copy] [--project <ruta>] [--cwd <dir>] [--json]      (alias: agent-prompt)

  --copy             Ademas lo copia al portapapeles (clip.exe/PowerShell, pbcopy, wl-copy/xclip); si falla, lo imprime igual y avisa por stderr
  --project <ruta>   Raiz (o subcarpeta) del proyecto; por defecto el directorio actual
  --json             {"ok":true,"command":"prompt","root","url","targetUrl","copied","agentPrompt"}
No necesita servidor ni navegador. Nunca incluye el token del servidor local. Codigos: 0 ok, 2 uso, 3 proyecto no encontrado.
`;

export function detectPromptCommand(argv: string[]): boolean {
  try {
    const { positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: { project: { type: "string" }, cwd: { type: "string" }, "state-dir": { type: "string" }, url: { type: "string" }, command: { type: "string" }, port: { type: "string" }, page: { type: "string" }, fallback: { type: "string" }, "server-port": { type: "string" }, lines: { type: "string", short: "n" }, "start-timeout": { type: "string" } },
    });
    return (PROMPT_COMMANDS as readonly string[]).includes(positionals[0] ?? "");
  } catch {
    return false;
  }
}

/** Ruta absoluta de packages/cli/AGENTS.md (contrato completo de la CLI). */
export function agentsDocPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "AGENTS.md");
}

/** Copia al portapapeles con lo que haya en el sistema. Devuelve true si algun metodo funciono. */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): boolean {
  const attempts: Array<{ cmd: string; args: string[]; input?: Buffer }> = [];
  if (platform === "win32") {
    // clip.exe lee UTF-16LE con BOM sin perder acentos.
    attempts.push({ cmd: "clip.exe", args: [], input: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]) });
    const b64 = Buffer.from(text, "utf8").toString("base64");
    attempts.push({
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`],
    });
  } else if (platform === "darwin") {
    attempts.push({ cmd: "pbcopy", args: [], input: Buffer.from(text, "utf8") });
  } else {
    attempts.push({ cmd: "wl-copy", args: [], input: Buffer.from(text, "utf8") });
    attempts.push({ cmd: "xclip", args: ["-selection", "clipboard"], input: Buffer.from(text, "utf8") });
  }
  for (const a of attempts) {
    try {
      const r = spawnSync(a.cmd, a.args, { ...(a.input ? { input: a.input } : {}), windowsHide: true, timeout: 5000, stdio: [a.input ? "pipe" : "ignore", "ignore", "ignore"] });
      if (!r.error && r.status === 0) return true;
    } catch {
      /* siguiente metodo */
    }
  }
  return false;
}

export interface PromptIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
}

export async function runPromptCommand(argv: string[], io: PromptIo): Promise<number> {
  const json = argv.includes("--json");
  const out = (s: string): void => io.stdout(s.endsWith("\n") ? s : s + "\n");
  try {
    let values;
    let positionals: string[];
    try {
      ({ values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" }, copy: { type: "boolean" }, project: { type: "string" }, cwd: { type: "string" }, "state-dir": { type: "string" } },
      }));
    } catch (err) {
      return fail(io, json, "invalid_request", (err as Error).message.split("\n")[0] ?? "Argumentos invalidos", COMMENT_EXIT.USAGE);
    }
    if (values.help) return out(PROMPT_HELP), COMMENT_EXIT.OK;
    if (positionals.length > 1) return fail(io, json, "invalid_request", "prompt no acepta argumentos posicionales", COMMENT_EXIT.USAGE);
    const base = values.cwd ? path.resolve(io.cwd, values.cwd) : io.cwd;
    const start = values.project ? path.resolve(base, values.project) : base;
    const root = locateRoot(start, { requirePf: false });

    // URL real si hay algo corriendo (proxy administrado o en primer plano / dev server administrado); si no, null.
    let url: string | null = null;
    let targetUrl: string | null = null;
    try {
      const px = await liveProxyState(root);
      if (px) {
        targetUrl = px.targetUrl;
        url = swapOrigin(px.targetUrl, px.baseUrl);
      } else {
        const s = await getStatus({ root, url: null });
        if (s.state !== "stopped") url = s.url;
      }
    } catch {
      /* sin URL: el prompt lo indica */
    }

    const prompt = buildAgentPrompt({ root, url, targetUrl, agentsDoc: agentsDocPath() });
    let copied = false;
    if (values.copy) {
      copied = copyToClipboard(prompt);
      if (!copied) io.stderr("Aviso: no se pudo copiar al portapapeles; copia el prompt de la salida.\n");
    }
    if (json) out(JSON.stringify({ ok: true, command: "prompt", root, url, targetUrl, copied, agentPrompt: prompt }));
    else {
      out(formatPromptBlock(prompt));
      if (copied) io.stderr("Prompt copiado al portapapeles.\n");
    }
    return COMMENT_EXIT.OK;
  } catch (err) {
    const d = toErrorData(err);
    return fail(io, json, (err as { code?: string }).code ?? d.code, err instanceof Error ? err.message : d.message, commentExitCode(err));
  }
}

function fail(io: PromptIo, json: boolean, code: string, message: string, exit: number): number {
  if (json) io.stdout(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
  else io.stderr(`Error: ${message}\n`);
  return exit;
}
