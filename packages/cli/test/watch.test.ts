import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRequest, createCommentStorage, listAgentRequests, PROMPT_BEGIN, PROMPT_END } from "@perfect-front/comment-storage";
import { runCli } from "../src/run";

let root: string;
const ID = "pf_01ARZ3NDEKTSV4RRFFQ69G5FAV";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pf-watch-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function run(args: string[], signal?: AbortSignal) {
  let stdout = "";
  const code = await runCli(args, { stdout: (s) => (stdout += s), stderr: () => undefined, cwd: root, ...(signal ? { signal } : {}) });
  return { code, stdout };
}

describe("watch", () => {
  it("--once imprime el prompt entre marcadores, marca la petición taken y sale", async () => {
    await createCommentStorage(root);
    const req = await createAgentRequest(root, { commentIds: [ID] });
    const r = await run(["watch", "--once", "--interval", "50"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Petición ${req.id}: 1 comentario(s)`);
    expect(r.stdout).toContain(PROMPT_BEGIN);
    expect(r.stdout).toContain(PROMPT_END);
    expect((await listAgentRequests(root))[0]!.status).toBe("taken");
    // Ya tomada: no se vuelve a imprimir; con la señal abortada sale sin esperar.
    const ac = new AbortController();
    ac.abort();
    const again = await run(["watch", "--interval", "50"], ac.signal);
    expect(again.code).toBe(0);
    expect(again.stdout).toBe("");
  });

  it("espera a que llegue una petición nueva", async () => {
    await createCommentStorage(root);
    const p = run(["watch", "--once", "--interval", "50"]);
    await new Promise((r) => setTimeout(r, 150));
    await createAgentRequest(root, { commentIds: [ID] });
    const r = await p;
    expect(r.stdout).toContain(PROMPT_BEGIN);
  });
});
