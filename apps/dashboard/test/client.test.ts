// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError, readSessionToken } from "../src/api/client";
import { makeComment } from "./fixtures";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const headersOf = (c: Call): Record<string, string> => c.init.headers as Record<string, string>;

describe("ApiClient", () => {
  it("envia Authorization Bearer y arma la query del listado", async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true, comments: [makeComment()], corrupt: [{ collection: "inbox", file: "x.json", code: "invalid_data", message: "roto" }] }));
    const api = new ApiClient({ token: "tok", fetch });
    const r = await api.listComments("p_1", { status: "pending", q: "a b", collection: "inbox" });
    expect(calls[0]!.url).toBe("/api/projects/p_1/comments?collection=inbox&status=pending&q=a+b");
    expect(headersOf(calls[0]!).Authorization).toBe("Bearer tok");
    expect(headersOf(calls[0]!)["X-PF-Include-Corrupt"]).toBe("1");
    expect(r.comments).toHaveLength(1);
    expect(r.corrupt).toHaveLength(1);
  });

  it("tolera servidores sin campo corrupt", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, comments: [] }));
    expect((await new ApiClient({ token: "t", fetch }).listComments("p")).corrupt).toEqual([]);
  });

  it("PATCH envia el control de conflictos y el cuerpo JSON", async () => {
    const c = makeComment();
    const { fetch, calls } = fakeFetch(() => json({ ok: true, comment: c }));
    await new ApiClient({ token: "t", fetch }).updateComment("p_1", "pf_01K7A", { comment: "x" }, "2026-10-03T15:30:00.000Z");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(headersOf(calls[0]!)["X-PF-Expected-Updated-At"]).toBe("2026-10-03T15:30:00.000Z");
    expect(headersOf(calls[0]!)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ comment: "x" });
  });

  it("mapea errores del servidor a ApiError tipado (conflicto, auth)", async () => {
    const { fetch } = fakeFetch(() => json({ ok: false, error: { code: "conflict", message: "cambió" } }, 409));
    const err = await new ApiClient({ token: "t", fetch }).updateComment("p", "pf_A", { comment: "x" }, "t").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "conflict", message: "cambió", isConflict: true });
    const { fetch: f401 } = fakeFetch(() => json({ ok: false, error: { code: "unauthorized", message: "no" } }, 401));
    expect(await new ApiClient({ token: "t", fetch: f401 }).listProjects().catch((e: unknown) => e)).toMatchObject({ isAuth: true });
  });

  it("errores de red y respuestas invalidas no revientan con excepciones crudas", async () => {
    const net = new ApiClient({ token: "t", fetch: (async () => { throw new TypeError("fail"); }) as unknown as typeof fetch });
    expect(await net.listProjects().catch((e: unknown) => e)).toMatchObject({ code: "network" });
    const { fetch } = fakeFetch(() => new Response("<html>", { status: 200 }));
    expect(await new ApiClient({ token: "t", fetch }).listProjects().catch((e: unknown) => e)).toMatchObject({ code: "bad_response" });
    const { fetch: f2 } = fakeFetch(() => json({ ok: true }));
    expect(await new ApiClient({ token: "t", fetch: f2 }).listProjects().catch((e: unknown) => e)).toMatchObject({ code: "bad_response" });
  });

  it("escapa ids en la URL, mueve por lote y descarga adjuntos como Blob", async () => {
    const { fetch, calls } = fakeFetch((c) => (c.url.includes("attachments") ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }) : json({ ok: true, results: [] })));
    const api = new ApiClient({ token: "t", fetch });
    await api.moveComments("p/../x", ["pf_A"], "resolved");
    expect(calls[0]!.url).toBe("/api/projects/p%2F..%2Fx/comments/move");
    const blob = await api.getAttachment("p_1", "pf_A", "attachments/pf_A.png");
    expect(calls[1]!.url).toBe("/api/projects/p_1/comments/pf_A/attachments/pf_A.png");
    expect(blob.size).toBe(3);
  });

  it("la URL de eventos lleva access_token y sin token no lo incluye", () => {
    expect(new ApiClient({ token: "a b" }).eventsUrl()).toBe("/api/events?access_token=a%20b");
    expect(new ApiClient({ token: null }).eventsUrl()).toBe("/api/events");
  });

  it("lee el token de la meta pf-token", () => {
    document.head.innerHTML = '<meta name="pf-token" content="abc123">';
    expect(readSessionToken()).toBe("abc123");
    document.head.innerHTML = '<meta name="pf-token" content="">';
    expect(readSessionToken()).toBeNull();
    document.head.innerHTML = "";
    expect(readSessionToken()).toBeNull();
  });
});
