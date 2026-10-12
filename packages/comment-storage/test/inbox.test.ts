import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildInboxPrompt, createAgentRequest, deriveAgentRequest, listAgentRequests, markAgentRequestTaken } from "../src/index";

let root: string;
beforeEach(async () => void (root = await fs.mkdtemp(path.join(os.tmpdir(), "pf-inbox-"))));
afterEach(() => fs.rm(root, { recursive: true, force: true }));

const A = "pf_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const B = "pf_01ARZ3NDEKTSV4RRFFQ69G5FAW";

describe("agent-inbox", () => {
  it("el prompt solo lleva conteo, ids, grupo y rutas", () => {
    const p = buildInboxPrompt({ root }, { ids: [A, B], groupId: "checkout" });
    expect(p).toContain(`Pendientes: 2 → ${A}, ${B}`);
    expect(p).toContain("checkout");
    expect(p).toContain(path.join(root, ".perfect-front", "groups.json"));
    expect(p).toContain("list --json");
  });

  it("crea, lista y marca taken; el estado se deriva de los comentarios", async () => {
    const req = await createAgentRequest(root, { commentIds: [A, B, A] });
    expect(req.commentIds).toEqual([A, B]);
    expect((await listAgentRequests(root)).map((r) => r.id)).toEqual([req.id]);
    expect(deriveAgentRequest(req, [{ id: A, status: "pending" }, { id: B, status: "pending" }]).status).toBe("pending");
    expect(deriveAgentRequest(req, [{ id: A, status: "in_progress" }, { id: B, status: "pending" }]).status).toBe("taken");
    expect(deriveAgentRequest(req, [{ id: A, status: "resolved" }, { id: B, status: "resolved" }]).status).toBe("done");
    const taken = await markAgentRequestTaken(root, req.id);
    expect(taken.status).toBe("taken");
    expect(deriveAgentRequest(taken, [{ id: A, status: "pending" }, { id: B, status: "pending" }]).status).toBe("taken");
    await expect(markAgentRequestTaken(root, "../x")).rejects.toThrow();
  });
});
