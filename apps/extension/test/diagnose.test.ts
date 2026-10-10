import { describe, expect, it } from "vitest";
import type { RunningServer } from "@perfect-front/shared";
import { diagnose } from "../src/popup/diagnose";

const servers: RunningServer[] = [
  { port: 45800, projects: [{ id: "p1" as never, name: "movil", url: "http://127.0.0.1:7788/", framework: null, processState: "running", managed: true, pendingCount: 0 }] },
];
const probe = (present: boolean, enabled: boolean, version: string | null = "1.0.0") => async () => ({ present, enabled, version });
const base = { servers, tabUrl: "http://localhost:7788/otra.html" };

describe("diagnóstico del popup (sondeo del mundo MAIN)", () => {
  it("(a) sin servidores", async () => {
    expect((await diagnose({ ...base, servers: [], probe: probe(true, true) })).kind).toBe("no-servers");
  });

  it("(b) la pestaña no es de ningún proyecto y no se sondea", async () => {
    let probed = false;
    const d = await diagnose({
      ...base,
      tabUrl: "http://localhost:5173/x",
      probe: async () => {
        probed = true;
      },
    });
    expect(d).toMatchObject({ kind: "no-project", tabOrigin: "http://localhost:5173" });
    expect(probed).toBe(false);
  });

  it("(c) pertenece al proyecto: capa activa / apagada", async () => {
    expect(await diagnose({ ...base, probe: probe(true, true) })).toMatchObject({ kind: "layer", active: true, projectName: "movil" });
    expect(await diagnose({ ...base, probe: probe(true, false) })).toMatchObject({ kind: "layer", active: false });
  });

  it("(d) window.__pf no existe: capa no cargada", async () => {
    const d = await diagnose({ ...base, probe: probe(false, false, null) });
    expect(d).toMatchObject({ kind: "no-layer" });
    expect(d.message).toContain("La capa no está cargada");
    expect(d.message).toContain("proxy");
  });

  it("(d) el sondeo falla o devuelve algo mal formado: capa no cargada", async () => {
    const fail = async () => {
      throw new Error("Cannot access contents");
    };
    expect((await diagnose({ ...base, probe: fail })).kind).toBe("no-layer");
    expect((await diagnose({ ...base, probe: async () => ({ present: "si", enabled: true, version: null }) })).kind).toBe("no-layer");
  });
});
