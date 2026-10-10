import { describe, expect, it } from "vitest";
import {
  CommentGroupRefSchema,
  CreateGroupRequestSchema,
  LIMITS,
  ReadingGroupSchema,
  ReorderGroupRequestSchema,
  UpdateGroupRequestSchema,
  VisualCommentSchema,
  generateCommentId,
} from "../src/index";
import { specCommentV2 } from "./fixtures";

const TS = "2026-10-03T15:30:00.000Z";

describe("CreateGroupRequestSchema", () => {
  it("aplica valores por defecto: note vacía y readFirst true", () => {
    expect(CreateGroupRequestSchema.parse({ name: "Checkout" })).toEqual({ name: "Checkout", note: "", readFirst: true });
  });

  it("acepta un id de grupo en minúsculas", () => {
    expect(CreateGroupRequestSchema.safeParse({ id: "checkout-2", name: "Checkout" }).success).toBe(true);
  });

  it("respeta el límite de nombre y nota", () => {
    expect(CreateGroupRequestSchema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateGroupRequestSchema.safeParse({ name: "n".repeat(LIMITS.groupName + 1) }).success).toBe(false);
    expect(CreateGroupRequestSchema.safeParse({ name: "ok", note: "n".repeat(LIMITS.groupNote + 1) }).success).toBe(false);
  });

  it.each([
    ["id con mayúsculas", { id: "Checkout", name: "x" }],
    ["id con traversal", { id: "../x", name: "x" }],
    ["id reservado de Windows", { id: "con", name: "x" }],
    ["readFirst no booleano", { name: "x", readFirst: "si" }],
    ["propiedad extra", { name: "x", extra: 1 }],
  ])("rechaza %s", (_n, value) => {
    expect(CreateGroupRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe("UpdateGroupRequestSchema", () => {
  it("rechaza un PATCH vacío", () => {
    expect(UpdateGroupRequestSchema.safeParse({}).success).toBe(false);
  });

  it("acepta cambios parciales", () => {
    expect(UpdateGroupRequestSchema.safeParse({ name: "Nuevo" }).success).toBe(true);
    expect(UpdateGroupRequestSchema.safeParse({ readFirst: false }).success).toBe(true);
    expect(UpdateGroupRequestSchema.safeParse({ note: "" }).success).toBe(true);
  });

  it("rechaza propiedades extra y nombre vacío", () => {
    expect(UpdateGroupRequestSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(UpdateGroupRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("ReorderGroupRequestSchema", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => generateCommentId(1_700_000_000_000 + i, new Uint8Array(16)));

  it("acepta un orden de comentarios y uno vacío (salen todos del grupo)", () => {
    expect(ReorderGroupRequestSchema.safeParse({ order: ids(2) }).success).toBe(true);
    expect(ReorderGroupRequestSchema.safeParse({ order: [] }).success).toBe(true);
  });

  it("rechaza ids duplicados", () => {
    const [a] = ids(1);
    expect(ReorderGroupRequestSchema.safeParse({ order: [a, a] }).success).toBe(false);
  });

  it("rechaza ids de comentario mal formados", () => {
    expect(ReorderGroupRequestSchema.safeParse({ order: ["abc"] }).success).toBe(false);
    expect(ReorderGroupRequestSchema.safeParse({ order: ["pf_ABC"] }).success).toBe(false);
  });

  it("admite hasta LIMITS.groupItems y rechaza uno más", () => {
    expect(ReorderGroupRequestSchema.safeParse({ order: ids(LIMITS.groupItems) }).success).toBe(true);
    expect(ReorderGroupRequestSchema.safeParse({ order: ids(LIMITS.groupItems + 1) }).success).toBe(false);
  });
});

describe("ReadingGroupSchema y referencia en el comentario", () => {
  const group = { id: "checkout", name: "Checkout", note: "Revisar el flujo de pago", readFirst: true, createdAt: TS, updatedAt: TS };

  it("acepta un grupo de lectura válido", () => {
    expect(ReadingGroupSchema.parse(group)).toEqual(group);
  });

  it("rechaza timestamps inválidos y propiedades extra", () => {
    expect(ReadingGroupSchema.safeParse({ ...group, createdAt: "ayer" }).success).toBe(false);
    expect(ReadingGroupSchema.safeParse({ ...group, extra: 1 }).success).toBe(false);
  });

  it("la referencia de grupo acepta posición 1..200", () => {
    expect(CommentGroupRefSchema.safeParse({ id: "checkout", position: 1 }).success).toBe(true);
    expect(CommentGroupRefSchema.safeParse({ id: "checkout", position: LIMITS.groupItems }).success).toBe(true);
    expect(CommentGroupRefSchema.safeParse({ id: "checkout", position: LIMITS.groupItems + 1 }).success).toBe(false);
  });

  it("la posición es 1-based", () => {
    expect(CommentGroupRefSchema.safeParse({ id: "checkout", position: 0 }).success).toBe(false);
    expect(CommentGroupRefSchema.safeParse({ id: "checkout", position: 1.5 }).success).toBe(false);
  });

  it("un comentario puede pertenecer a un grupo o a ninguno", () => {
    const withGroup = specCommentV2();
    withGroup.group = { id: "checkout", position: 2 };
    expect(VisualCommentSchema.safeParse(withGroup).success).toBe(true);
    expect(VisualCommentSchema.safeParse(specCommentV2()).success).toBe(true);
  });

  it("rechaza una referencia de grupo con id inválido en el comentario", () => {
    const c = specCommentV2();
    c.group = { id: "Checkout", position: 1 };
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });
});
