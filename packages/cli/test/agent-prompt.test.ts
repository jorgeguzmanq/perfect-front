import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentPrompt, formatPromptBlock, PROMPT_BEGIN, PROMPT_END, type AgentPromptContext } from "../src/agent-prompt";

const ROOT = path.resolve("/tmp/pf-agent-prompt-root");
const PF = path.join(ROOT, ".perfect-front");
const ATTACHMENTS = path.join(PF, "attachments");
const GROUPS = path.join(PF, "groups.json");
const AGENTS_DOC = path.resolve("/tmp/pf-agent-prompt-root/packages/cli/AGENTS.md");
const PROXY_URL = "http://localhost:4000/pricing";
const DEV_URL = "http://localhost:5173/pricing";

const full = (over: Partial<AgentPromptContext> = {}): string =>
  buildAgentPrompt({ root: ROOT, url: PROXY_URL, targetUrl: DEV_URL, agentsDoc: AGENTS_DOC, ...over });

describe("buildAgentPrompt: rutas absolutas del contexto", () => {
  it("incluye raíz, .perfect-front, adjuntos, groups.json, URL y URL original", () => {
    const p = full();
    expect(p).toContain(`Raíz del proyecto: ${ROOT}`);
    expect(p).toContain(`Datos de Perfect Front: ${PF}`);
    expect(p).toContain(path.join(PF, "comments", "<coleccion>", "<id>.json"));
    expect(p).toContain(`Adjuntos y capturas (imágenes PNG/JPEG/WebP, nombre pf_<id>[-n].<ext>): ${ATTACHMENTS}`);
    expect(p).toContain(`Grupos de lectura (nombre y nota de cada grupo): ${GROUPS}`);
    expect(p).toContain(`URL del proyecto (con la capa, via proxy): ${PROXY_URL}`);
    expect(p).toContain(`URL original (dev server): ${DEV_URL}`);
    expect(p).toContain(`Contrato completo de la CLI: ${AGENTS_DOC}`);
  });

  it("normaliza la raíz con path.resolve", () => {
    const p = buildAgentPrompt({ root: path.join(ROOT, "src", ".."), url: PROXY_URL });
    expect(p).toContain(`Raíz del proyecto: ${ROOT}`);
  });

  it("sin url ni targetUrl indica que la app no está activa y usa el comando de la CLI", () => {
    const p = buildAgentPrompt({ root: ROOT, url: null, targetUrl: null });
    expect(p).toContain("URL del proyecto: no disponible (el dev server no está activo; arráncalo con `perfect-front`)");
    expect(p).not.toContain("URL del proyecto (con la capa");
    expect(p).not.toContain("URL original");
    expect(p).not.toContain("Contrato completo de la CLI");
    expect(p).toContain("Cuando la app este activa, abre su URL");
  });

  it("no repite la URL original cuando es igual a la del proyecto", () => {
    const p = buildAgentPrompt({ root: ROOT, url: DEV_URL, targetUrl: DEV_URL });
    expect(p).toContain(`URL del proyecto (con la capa, via proxy): ${DEV_URL}`);
    expect(p).not.toContain("URL original (dev server)");
  });

  it("usa targetUrl como URL del proyecto si no hay url", () => {
    const p = buildAgentPrompt({ root: ROOT, url: null, targetUrl: DEV_URL });
    expect(p).toContain(`URL del proyecto (con la capa, via proxy): ${DEV_URL}`);
  });

  it("el comando de la CLI configurable aparece en los ejemplos", () => {
    const p = buildAgentPrompt({ root: ROOT, url: null, cli: "pf" });
    expect(p).toContain("arráncalo con `pf`");
    expect(p).toContain("`pf list --json`");
    expect(p).toContain("`pf resolve <id> --summary");
  });
});

describe("buildAgentPrompt: subcomandos y contrato", () => {
  it("nombra los subcomandos reales", () => {
    const p = full();
    expect(p).toContain("`perfect-front list --json`");
    expect(p).toContain("`perfect-front show <id> --json`");
    expect(p).toContain("`perfect-front claim <id>");
    expect(p).toContain("`perfect-front resolve <id> --summary");
    expect(p).toContain("`status <id> pending|in_progress|ignored|archived`");
    expect(p).toContain("`ignore <id>`");
    expect(p).toContain("`reopen <id>`");
    expect(p).toContain('`edit <id> --comment "..."`');
    expect(p).toContain("`move <id...> --to <coleccion>`");
    expect(p).toContain("`export --format md [--out archivo.md]`");
  });

  it("documenta el bloqueo optimista y su alias", () => {
    const p = full();
    expect(p).toContain("--expect-updated-at <updatedAt>");
    expect(p).toContain("--expect-updated-at <iso>` (alias `--rev`)");
    expect(p).toContain("--files a.tsx,b.css");
    expect(p).toContain("--verification");
  });

  it("documenta los códigos de salida 6 y 7 con sus significados", () => {
    const p = full();
    expect(p).toContain("6 id no encontrado");
    expect(p).toContain("7 conflicto");
    expect(p).toContain("stale_revisión");
    expect(p).toContain("0 ok, 2 uso/validacion, 3 proyecto o .perfect-front no encontrado");
  });

  it("indica filtros de list y que no hay filtro por ruta ni grupo", () => {
    const p = full();
    expect(p).toContain("--status pending|in_progress|resolved|ignored|archived|all");
    expect(p).toContain("--collection <c>");
    expect(p).toContain("--q <texto>");
    expect(p).toContain("No hay filtro por ruta ni por grupo");
  });

  it("prohíbe editar .perfect-front a mano", () => {
    expect(full()).toContain(`NO edites nada dentro de ${PF} a mano`);
  });
});

describe("buildAgentPrompt: propuestas, grupos y multiselección", () => {
  it("describe las propuestas de texto, i18n, estilo y reorder", () => {
    const p = full();
    expect(p).toContain("`proposals[]`");
    expect(p).toContain("`text_fixed` / `text_dynamic`");
    expect(p).toContain("`text_i18n`");
    expect(p).toContain("`locales[]`");
    expect(p).toContain("`style`: `changes[]`");
    expect(p).toContain("`origin: editable`");
    expect(p).toContain("`foundation`");
    expect(p).toContain("`reorder`");
    expect(p).toContain("`targetSelector: null`");
  });

  it("describe grupos con readFirst y orden por group.position", () => {
    const p = full();
    expect(p).toContain("`group`");
    expect(p).toContain("`readFirst`");
    expect(p).toContain("`group.position`");
    expect(p).toContain(`lee la nota del grupo en ${GROUPS}`);
  });

  it("describe multiselección con extraTargets", () => {
    const p = full();
    expect(p).toContain("Multiselección");
    expect(p).toContain("`extraTargets[]`");
    expect(p).toContain("El cambio aplica a todos");
  });

  it("incluye la instrucción de eliminar elemento", () => {
    expect(full()).toContain("«Eliminar este elemento.»");
  });

  it("describe archivo:línea y campos de localización", () => {
    const p = full();
    expect(p).toContain("`source` (`file`, `line`)");
    expect(p).toContain("`location.selector`");
    expect(p).toContain("`location.componentHint`");
    expect(p).toContain("`attachments[].absolutePath`");
  });
});

describe("buildAgentPrompt: seguridad del contenido", () => {
  it("no contiene token ni discovery.json aunque el objeto de entrada los traiga", () => {
    // El tipo no declara estos campos: se pasan por variable para no violar el tipado.
    const leaky = { root: ROOT, url: PROXY_URL, token: "tok-FICTICIO-no-debe-salir", discoveryJson: '{"token":"tok-FICTICIO-no-debe-salir"}' };
    const p = buildAgentPrompt(leaky);
    // Ojo: la palabra «token» aparece legítimamente en el contrato (`foundation` = token/reset); se comprueba el valor.
    expect(p).not.toContain("tok-FICTICIO-no-debe-salir");
    expect(p).not.toContain("discovery.json");
  });

  it("no menciona discovery.json", () => {
    expect(full()).not.toContain("discovery.json");
  });
});

describe("formatPromptBlock", () => {
  it("envuelve el prompt con los delimitadores", () => {
    const block = formatPromptBlock("linea 1\nlinea 2");
    expect(block).toBe(`${PROMPT_BEGIN}\nlinea 1\nlinea 2\n${PROMPT_END}`);
    expect(block.startsWith(PROMPT_BEGIN + "\n")).toBe(true);
    expect(block.endsWith("\n" + PROMPT_END)).toBe(true);
  });

  it("quita saltos de línea finales del prompt antes de cerrar", () => {
    expect(formatPromptBlock("a\n\n\n")).toBe(`${PROMPT_BEGIN}\na\n${PROMPT_END}`);
  });

  it("envuelve el prompt real generado", () => {
    const p = full();
    const block = formatPromptBlock(p);
    expect(block).toContain(p);
    expect(block.indexOf(PROMPT_BEGIN)).toBe(0);
    expect(block.lastIndexOf(PROMPT_END)).toBe(block.length - PROMPT_END.length);
  });
});
