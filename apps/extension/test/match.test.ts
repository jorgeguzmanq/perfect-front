import { describe, expect, it } from "vitest";
import type { RunningServer } from "@perfect-front/shared";
import { findProject, originKey } from "../src/match";

const p = (id: string, url: string | null) => ({ id: id as never, name: id, url, framework: null, processState: "running" as const, managed: true, pendingCount: 0 });
const servers = (...projects: ReturnType<typeof p>[]): RunningServer[] => [{ port: 45800, projects }];

describe("coincidencia por origen", () => {
  it("localhost, 127.0.0.1 y [::1] son el mismo host; puerto y protocolo cuentan", () => {
    expect(originKey("http://localhost:5500/")).toBe(originKey("http://127.0.0.1:5500/x"));
    expect(originKey("http://[::1]:5500/")).toBe(originKey("http://localhost:5500/"));
    expect(originKey("http://localhost:5501/")).not.toBe(originKey("http://localhost:5500/"));
    expect(originKey("https://localhost:5500/")).not.toBe(originKey("http://localhost:5500/"));
  });

  it("varias páginas del mismo servidor pertenecen al proyecto", () => {
    const s = servers(p("movil", "http://127.0.0.1:5500/control-movil-v1.html"));
    for (const u of ["http://127.0.0.1:5500/otra.html", "http://localhost:5500/control-movil-v1.html", "http://localhost:5500/"]) {
      expect(findProject(s, u)?.project.id).toBe("movil");
    }
    expect(findProject(s, "http://localhost:5501/")).toBeUndefined();
  });

  it("desempata por prefijo más largo; sin prefijo gana cualquiera del mismo origen", () => {
    const s = servers(p("raiz", "http://localhost:3000/"), p("admin", "http://localhost:3000/admin"));
    expect(findProject(s, "http://localhost:3000/admin/users")?.project.id).toBe("admin");
    expect(findProject(s, "http://localhost:3000/home")?.project.id).toBe("raiz");
    const t = servers(p("a", "http://localhost:3000/a"), p("b", "http://localhost:3000/b"));
    expect(findProject(t, "http://localhost:3000/zzz")).toBeDefined();
  });
});
