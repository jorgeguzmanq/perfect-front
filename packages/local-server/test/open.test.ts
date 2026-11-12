import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeHarness } from "./helpers";

async function setup(execFile: (f: string, a: string[]) => Promise<void>) {
  const h = await makeHarness({ execFile });
  const pid = await h.register();
  await fs.mkdir(path.join(h.projectRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(h.projectRoot, "src", "App.tsx"), "x");
  return { h, pid };
}

describe("POST /api/projects/:id/open", () => {
  it("200: ejecuta `code -g ruta:linea:col` sin shell, con ruta absoluta dentro del proyecto", async () => {
    const calls: [string, string[]][] = [];
    const { h, pid } = await setup(async (f, a) => void calls.push([f, a]));
    const r = await h.json(`/api/projects/${pid}/open`, { body: { file: "src/App.tsx", line: 12, column: 5 } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, opened: { file: "src/App.tsx", line: 12, column: 5 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("code");
    expect(calls[0]![1]).toEqual(["-g", `${path.join(h.projectRoot, "src", "App.tsx")}:12:5`]);
    // sin línea: solo la ruta
    await h.json(`/api/projects/${pid}/open`, { body: { file: "src/App.tsx" } });
    expect(calls[1]![1]).toEqual(["-g", path.join(h.projectRoot, "src", "App.tsx")]);
  });

  it("404: archivo inexistente o directorio", async () => {
    const calls: unknown[] = [];
    const { h, pid } = await setup(async () => void calls.push(1));
    expect((await h.json(`/api/projects/${pid}/open`, { body: { file: "src/Nope.tsx" } })).status).toBe(404);
    expect((await h.json(`/api/projects/${pid}/open`, { body: { file: "src" } })).status).toBe(404);
    expect((await h.json("/api/projects/proj_zzzzzzzz/open", { body: { file: "a" } })).status).toBeGreaterThanOrEqual(400);
    expect(calls).toHaveLength(0);
  });

  it("rechaza traversal, absolutas externas y cuerpos inválidos sin ejecutar nada", async () => {
    const calls: unknown[] = [];
    const { h, pid } = await setup(async () => void calls.push(1));
    const outside = path.join(path.dirname(h.projectRoot), "fuera.txt");
    await fs.writeFile(outside, "x");
    for (const file of ["../fuera.txt", "src/../../fuera.txt", outside, "..\fuera.txt", "src/App.tsx\0"]) {
      const r = await h.json(`/api/projects/${pid}/open`, { body: { file } });
      expect(r.status, file).toBe(400);
    }
    for (const body of [{}, { file: "" }, { file: "src/App.tsx", line: 0 }, { file: "src/App.tsx", x: 1 }]) {
      expect((await h.json(`/api/projects/${pid}/open`, { body })).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    await fs.rm(outside, { force: true });
  });

  it("exige token y rechaza el rol extensión", async () => {
    const { h, pid } = await setup(async () => {});
    expect((await h.json(`/api/projects/${pid}/open`, { auth: "none", body: { file: "src/App.tsx" } })).status).toBe(401);
    expect((await h.json(`/api/projects/${pid}/open`, { auth: "mal", body: { file: "src/App.tsx" } })).status).toBe(401);
  });

  it("editor_not_found (ENOENT) devuelve error claro; otro fallo es process_error", async () => {
    const { h, pid } = await setup(async () => {
      throw Object.assign(new Error("spawn code ENOENT"), { code: "ENOENT" });
    });
    const r = await h.json(`/api/projects/${pid}/open`, { body: { file: "src/App.tsx" } });
    expect(r.status).toBe(424);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe("editor_not_found");
    expect(r.body.error.message).toContain("code");

    const { h: h2, pid: pid2 } = await setup(async () => {
      throw new Error("boom C:/secreto");
    });
    const r2 = await h2.json(`/api/projects/${pid2}/open`, { body: { file: "src/App.tsx" } });
    expect(r2.status).toBe(500);
    expect(r2.body.error.code).toBe("process_error");
    expect(JSON.stringify(r2.body)).not.toContain("secreto");
  });
});
