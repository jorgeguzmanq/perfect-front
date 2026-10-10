import { describe, expect, it } from "vitest";
import { MESSAGE_RESPONSE_SCHEMAS, OFFICIAL_EXTENSION_ID, EXTENSION_ID_RE, ToServiceWorkerMessageSchema } from "../src";

describe("protocolo de la extensión", () => {
  it("el ID oficial es un ID de extensión válido", () => {
    expect(EXTENSION_ID_RE.test(OFFICIAL_EXTENSION_ID)).toBe(true);
  });
  it("acepta mensajes válidos", () => {
    for (const m of [
      { v: 1, type: "pf/context.get", url: "http://localhost:5173/" },
      { v: 1, type: "pf/projects.list" },
      { v: 1, type: "pf/project.open", port: 45800, projectId: "abc123" },
      { v: 1, type: "pf/layer.get" },
      { v: 1, type: "pf/layer.set", enabled: false },
    ]) {
      expect(ToServiceWorkerMessageSchema.safeParse(m).success, m.type).toBe(true);
    }
  });
  it("rechaza tipos desconocidos, versión incorrecta, propiedades extra y puertos fuera de rango", () => {
    expect(ToServiceWorkerMessageSchema.safeParse({ v: 1, type: "pf/otro" }).success).toBe(false);
    expect(ToServiceWorkerMessageSchema.safeParse({ v: 1, type: "pf/pair.start", code: "ABCD2345" }).success).toBe(false);
    expect(ToServiceWorkerMessageSchema.safeParse({ v: 2, type: "pf/capture.request" }).success).toBe(false);
    expect(ToServiceWorkerMessageSchema.safeParse({ v: 1, type: "pf/capture.request", root: "/etc" }).success).toBe(false);
    expect(ToServiceWorkerMessageSchema.safeParse({ v: 1, type: "pf/project.open", port: 80, projectId: "abc123" }).success).toBe(false);
  });
  it("valida respuestas de éxito y de error", () => {
    const s = MESSAGE_RESPONSE_SCHEMAS["pf/layer.set"];
    expect(s.safeParse({ ok: true, data: { enabled: true } }).success).toBe(true);
    expect(s.safeParse({ ok: true, data: { enabled: true, x: 1 } }).success).toBe(false);
    const l = MESSAGE_RESPONSE_SCHEMAS["pf/projects.list"];
    expect(l.safeParse({ ok: true, data: { servers: [] } }).success).toBe(true);
  });
});
