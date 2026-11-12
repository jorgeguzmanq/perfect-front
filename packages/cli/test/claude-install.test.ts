import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultClaudeSource, detectClaudeCommand, installClaude, runClaudeCommand, summarize } from "../src/claude-install";
import { runCli } from "../src/run";

// Siempre con --home temporal: nunca se toca el ~/.claude real.

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pf-claude-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const claude = (...p: string[]): string => path.join(home, ".claude", ...p);
const exists = (p: string): boolean => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runClaudeCommand(argv, { stdout: (s) => (out += s), stderr: (s) => (err += s) });
  return { code, out, err };
}

describe("assets", () => {
  it("el repo trae el skill perfect-front y los comandos pf, pf-watch y pf-status", () => {
    const src = defaultClaudeSource();
    expect(fs.existsSync(path.join(src, "skills", "perfect-front", "SKILL.md"))).toBe(true);
    for (const c of ["pf", "pf-watch", "pf-status"]) expect(fs.existsSync(path.join(src, "commands", `${c}.md`))).toBe(true);
    expect(fs.readFileSync(path.join(src, "skills", "perfect-front", "SKILL.md"), "utf8")).toMatch(/^---\nname: perfect-front\n/);
  });
});

describe("installClaude", () => {
  it("enlaza skill y comandos y es idempotente", () => {
    const first = installClaude({ home });
    expect(first.items).toHaveLength(4);
    expect(first.items.every((i) => i.action === "linked" || i.action === "copied")).toBe(true);
    expect(fs.readFileSync(claude("skills", "perfect-front", "SKILL.md"), "utf8")).toContain("perfect-front");
    expect(fs.readFileSync(claude("commands", "pf.md"), "utf8")).toContain("/pf");

    const second = installClaude({ home });
    expect(second.items.every((i) => i.action === "unchanged")).toBe(true);
    expect(exists(claude("commands", "pf.md.bak"))).toBe(false);
  });

  it("no pisa lo ajeno sin --force (OMITIDO) y con --force lo respalda como .bak-<fecha>", () => {
    fs.mkdirSync(claude("commands"), { recursive: true });
    fs.writeFileSync(claude("commands", "pf.md"), "mio");

    const skipped = installClaude({ home });
    expect(skipped.items.find((i) => i.name === "pf.md")!.action).toBe("skipped");
    expect(fs.readFileSync(claude("commands", "pf.md"), "utf8")).toBe("mio");
    expect(summarize(skipped.items).skipped).toBe(1);

    const forced = installClaude({ home, force: true, now: () => new Date("2026-10-15T12:30:45.000Z") });
    const item = forced.items.find((i) => i.name === "pf.md")!;
    expect(item.action).toBe("replaced");
    expect(item.backup).toBe(claude("commands", "pf.md.bak-20261015-123045"));
    expect(fs.readFileSync(item.backup!, "utf8")).toBe("mio");
    expect(fs.readFileSync(claude("commands", "pf.md"), "utf8")).toContain("/pf");

    // Un segundo --force con el mismo instante no pierde el respaldo anterior.
    expect(installClaude({ home, force: true }).items.every((i) => i.action === "unchanged")).toBe(true);
  });

  it("un enlace/copia previo que apunta a otra cosa se respalda con --force, sin borrar nada", () => {
    fs.mkdirSync(claude("skills", "perfect-front"), { recursive: true });
    fs.writeFileSync(claude("skills", "perfect-front", "SKILL.md"), "otro skill");
    expect(installClaude({ home }).items.find((i) => i.name === "perfect-front")!.action).toBe("skipped");
    const r = installClaude({ home, force: true });
    const it1 = r.items.find((i) => i.name === "perfect-front")!;
    expect(it1.action).toBe("replaced");
    expect(fs.readFileSync(path.join(it1.backup!, "SKILL.md"), "utf8")).toBe("otro skill");
  });
});

describe("perfect-front claude (CLI)", () => {
  it("se detecta como subcomando y no confunde otros", () => {
    expect(detectClaudeCommand(["claude", "--home", "x"])).toBe(true);
    expect(detectClaudeCommand(["--home", "x", "claude", "--force"])).toBe(true);
    expect(detectClaudeCommand(["list", "--json"])).toBe(false);
    expect(detectClaudeCommand(["claude.html"])).toBe(false);
  });

  it("--json devuelve un unico objeto con items y resumen", async () => {
    const r = await run(["claude", "--home", home, "--json"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ ok: true, command: "claude", force: false });
    expect(j.claudeDir).toBe(claude());
    expect(j.items).toHaveLength(4);
    expect(j.summary.skipped).toBe(0);
    expect(r.err).toBe("");
  });

  it("texto humano: enlazado, ya estaba y OMITIDO", async () => {
    fs.mkdirSync(claude("commands"), { recursive: true });
    fs.writeFileSync(claude("commands", "pf-status.md"), "ajeno");
    const a = await run(["claude", "--home", home]);
    expect(a.out).toContain("OMITIDO");
    expect(a.out).toMatch(/enlazado|copiado/);
    const b = await run(["claude", "--home", home]);
    expect(b.out).toContain("ya estaba");
    expect(b.out).toContain("OMITIDO");
  });

  it("opcion desconocida = codigo 2, tambien en JSON", async () => {
    expect((await run(["claude", "--nope", "--home", home])).code).toBe(2);
    const j = await run(["claude", "--bogus", "--json"]);
    expect(j.code).toBe(2);
    expect(JSON.parse(j.out)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect((await run(["claude", "extra", "--home", home])).code).toBe(2);
  });

  it("runCli lo enruta (sin tocar el home real)", async () => {
    let out = "";
    const code = await runCli(["claude", "--home", home, "--json"], { stdout: (s: string) => (out += s), stderr: () => undefined, cwd: home } as never);
    expect(code).toBe(0);
    expect(JSON.parse(out).ok).toBe(true);
    expect(exists(claude("commands", "pf-watch.md"))).toBe(true);
  });
});
