import { describe, expect, it } from "vitest";
import { ProjectConfigSchema, isSafeHtmlEntry, migrateProjectConfig } from "../src/index";

describe("ProjectConfig.entry", () => {
  it("acepta rutas relativas .html y migra v1 sin cambios", () => {
    const cfg = { version: 1, entry: "docs/about.html" };
    expect(migrateProjectConfig(cfg)).toEqual(cfg);
    expect(ProjectConfigSchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it.each(["/etc/x.html", "C:/x.html", "../x.html", "a/../x.html", "a\\b.html", "a//b.html", "./a.html", "a.txt", "a\0.html", ""])(
    "rechaza %j",
    (entry) => {
      expect(isSafeHtmlEntry(entry)).toBe(false);
      expect(ProjectConfigSchema.safeParse({ version: 1, entry }).success).toBe(false);
    },
  );
});
