import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentInput, makeHarness } from "./helpers";

const SECRET = "TEXTO-SECRETO-DEL-COMENTARIO";

describe("peticiones al agente (agent-inbox)", () => {
  it("crea la petición con el prompt sin texto de comentarios y deriva su estado", async () => {
    const h = await makeHarness();
    const pid = await h.register();
    const a = await h.json(`/api/projects/${pid}/comments`, { body: commentInput({ comment: SECRET }) });
    const id = a.body.comment.id as string;

    const r = await h.json(`/api/projects/${pid}/agent/requests`, { body: {} });
    expect(r.status).toBe(201);
    expect(r.body.request.commentIds).toEqual([id]);
    expect(r.body.request.status).toBe("pending");
    expect(r.body.request.prompt).toBeUndefined();

    const file = path.join(h.projectRoot, ".perfect-front", "agent-inbox", `${r.body.request.id}.json`);
    const stored = JSON.parse(await fs.readFile(file, "utf8"));
    expect(stored.status).toBe("pending");
    expect(stored.prompt).toContain(`Pendientes: 1 → ${id}`);
    expect(stored.prompt).toContain(path.join(h.projectRoot, ".perfect-front", "comments"));
    expect(stored.prompt).not.toContain(SECRET);
    expect(stored.prompt).not.toContain(h.token);
    expect(stored.prompt).not.toContain(h.cliToken);

    // pending -> taken (un comentario pasa a in_progress) -> done (resuelto)
    await h.json(`/api/projects/${pid}/comments/${id}`, { method: "PATCH", body: { status: "in_progress" } });
    expect((await h.json(`/api/projects/${pid}/agent/requests`)).body.requests[0].status).toBe("taken");
    await h.json(`/api/projects/${pid}/comments/${id}/resolve`, { body: { summary: "ok" } });
    expect((await h.json(`/api/projects/${pid}/agent/requests`)).body.requests[0].status).toBe("done");
  });

  it("acepta commentIds, rechaza ids desconocidos, cola vacía y campos extra", async () => {
    const h = await makeHarness();
    const pid = await h.register();
    expect((await h.json(`/api/projects/${pid}/agent/requests`, { body: {} })).status).toBe(400);
    const a = await h.json(`/api/projects/${pid}/comments`, { body: commentInput() });
    const ok = await h.json(`/api/projects/${pid}/agent/requests`, { body: { commentIds: [a.body.comment.id] } });
    expect(ok.status).toBe(201);
    const bad = await h.json(`/api/projects/${pid}/agent/requests`, { body: { commentIds: ["pf_01ARZ3NDEKTSV4RRFFQ69G5FAV"] } });
    expect(bad.status).toBe(404);
    expect((await h.json(`/api/projects/${pid}/agent/requests`, { body: { extra: 1 } })).status).toBe(400);
  });
});
