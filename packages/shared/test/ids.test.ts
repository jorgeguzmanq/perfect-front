import { describe, expect, it } from "vitest";
import {
  AttachmentPathSchema,
  CollectionNameSchema,
  CommentIdSchema,
  ProjectIdSchema,
  TimestampSchema,
  generateCommentId,
} from "../src/index";

describe("ids", () => {
  it("acepta ids y colecciones válidos", () => {
    expect(CommentIdSchema.safeParse("pf_01K7A").success).toBe(true);
    expect(CollectionNameSchema.safeParse("inbox").success).toBe(true);
    expect(CollectionNameSchema.safeParse("release-2").success).toBe(true);
    expect(ProjectIdSchema.safeParse("mi-proyecto_1").success).toBe(true);
  });

  it.each([
    "",
    "..",
    "../x",
    "a/b",
    "a\\b",
    "C:\\x",
    "/abs",
    "con",
    "NUL",
    "com1",
    "lpt9",
    "a\u0000b",
    "a\nb",
    "Mayus",
    ".hidden",
    "a.",
    "x".repeat(65),
  ])("rechaza colección %j", (v) => {
    expect(CollectionNameSchema.safeParse(v).success).toBe(false);
  });

  it.each(["", "..", "a/b", "a\\b", "C:", "aux", "PRN", "a\u0007", "-x"])("rechaza ProjectId %j", (v) => {
    expect(ProjectIdSchema.safeParse(v).success).toBe(false);
  });

  it.each(["01K7A", "pf_", "pf_abc", "pf_01K7/A", "pf_../x", "pf_01I7A"])("rechaza CommentId %j", (v) => {
    expect(CommentIdSchema.safeParse(v).success).toBe(false);
  });

  it("genera ids válidos y ordenables por tiempo", () => {
    const a = generateCommentId(1_700_000_000_000);
    const b = generateCommentId(1_700_000_001_000);
    expect(CommentIdSchema.safeParse(a).success).toBe(true);
    expect(a < b).toBe(true);
  });

  it("valida adjuntos relativos", () => {
    expect(AttachmentPathSchema.safeParse("attachments/pf_01K7A.png").success).toBe(true);
    for (const bad of ["../a.png", "attachments/../a.png", "/attachments/a.png", "attachments\\a.png", "attachments/con.png", "C:/a.png"]) {
      expect(AttachmentPathSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("timestamps", () => {
  it("acepta ISO UTC", () => {
    expect(TimestampSchema.safeParse("2026-10-03T15:30:00.000Z").success).toBe(true);
    expect(TimestampSchema.safeParse("2026-10-03T15:30:00Z").success).toBe(true);
  });
  it.each(["2026-10-03", "2026-10-03T15:30:00", "2026-10-03T15:30:00+02:00", "2026-13-40T15:30:00.000Z", "ayer", "2026-02-30T00:00:00.000Z"])(
    "rechaza %j",
    (v) => {
      expect(TimestampSchema.safeParse(v).success).toBe(false);
    },
  );
});
