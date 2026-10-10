import { describe, expect, it } from "vitest";
import {
  ErrorResponseSchema,
  PerfectFrontError,
  PerfectFrontErrorSchema,
  migrateComment,
  migrateProjectConfig,
  toErrorData,
} from "../src/index";
import { specComment, specConfig } from "./fixtures";

function catchError(fn: () => unknown): PerfectFrontError {
  try {
    fn();
  } catch (e) {
    return e as PerfectFrontError;
  }
  throw new Error("no lanzó");
}

describe("migrador", () => {
  it("v1 es identidad", () => {
    expect(migrateComment(specComment())).toEqual(specComment());
    expect(migrateProjectConfig(specConfig)).toEqual(specConfig);
  });

  it("versión futura da error comprensible", () => {
    const e = catchError(() => migrateComment({ ...specComment(), version: 2 }));
    expect(e.code).toBe("unsupported_version");
    expect(e.message).toMatch(/más nueva/);
    expect(e.message).toMatch(/Actualiza/);
  });

  it("versión ausente, inválida o 0", () => {
    expect(catchError(() => migrateComment({})).message).toMatch(/falta el campo "version"/);
    expect(catchError(() => migrateComment({ version: "1" })).code).toBe("invalid_data");
    expect(catchError(() => migrateProjectConfig({ version: 0 })).code).toBe("invalid_data");
    expect(catchError(() => migrateComment(null)).code).toBe("invalid_data");
    expect(catchError(() => migrateComment([])).code).toBe("invalid_data");
  });

  it("datos inválidos de v1 incluyen detalles sin valores", () => {
    const e = catchError(() => migrateComment({ ...specComment(), status: "zzz-secret" }));
    expect(e.code).toBe("invalid_data");
    expect(e.details?.some((d) => d.path === "status")).toBe(true);
    expect(JSON.stringify(e.toJSON())).not.toContain("zzz-secret");
  });
});

describe("errores serializables", () => {
  it("roundtrip de PerfectFrontError", () => {
    const e = new PerfectFrontError("not_found", "Comentario no encontrado");
    const data = JSON.parse(JSON.stringify(e));
    expect(PerfectFrontErrorSchema.parse(data)).toEqual({ code: "not_found", message: "Comentario no encontrado" });
    expect(ErrorResponseSchema.safeParse({ ok: false, error: data }).success).toBe(true);
  });

  it("errores desconocidos no filtran el mensaje original", () => {
    const d = toErrorData(new Error("ENOENT C:\\secreto\\x"));
    expect(d).toEqual({ code: "internal_error", message: "Error interno" });
  });

  it("rechaza códigos inventados", () => {
    expect(PerfectFrontErrorSchema.safeParse({ code: "boom", message: "x" }).success).toBe(false);
  });
});
