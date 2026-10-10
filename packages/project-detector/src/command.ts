import { DetectionError } from "./types";

const SHELL_OPERATORS = /^(&&|\|\||[|;&<>]|\d?>>?)$/;

/** Separa una línea en [command, ...args] respetando comillas; nunca invoca un shell. */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let has = false;
  let quote: '"' | "'" | null = null;
  const bad = (m: string): never => {
    throw new DetectionError("invalid_command", m);
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) cur += input[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) bad("Comillas sin cerrar en el comando");
  if (has) tokens.push(cur);
  if (tokens.length === 0) bad("Comando vacío");
  for (const t of tokens) if (SHELL_OPERATORS.test(t)) bad("Operadores de shell no permitidos en el comando");
  return tokens;
}

export function splitCommand(input: string): { command: string; args: string[] } {
  const [command, ...args] = tokenizeCommand(input) as [string, ...string[]];
  return { command, args };
}
