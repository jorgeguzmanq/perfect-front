import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DetectionResult } from "@perfect-front/project-detector";
import { withSourcePlugin } from "../src/source";

function det(over: Partial<DetectionResult> = {}, pm = "pnpm"): DetectionResult {
  return {
    root: "/p",
    projectDir: "/p",
    configPath: null,
    name: "p",
    kind: "dev-server",
    static: null,
    framework: { bundler: "vite", ui: "react" },
    packageManager: { name: pm as "pnpm", version: null, source: "x" },
    plan: { command: pm, args: ["run", "dev"], cwd: "/p", source: "script" },
    url: "http://localhost:5173",
    port: 5173,
    reasons: [],
    ...over,
  };
}
const target = (d: DetectionResult) => ({ root: d.root, plan: { command: d.plan.command, args: d.plan.args, cwd: d.plan.cwd }, url: d.url });

describe("withSourcePlugin", () => {
  it("Vite+React: anade --config del envoltorio en el state-dir, sin tocar el proyecto", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cli-src-"));
    const project = path.join(tmp, "app");
    fs.mkdirSync(project);
    const d = det({ projectDir: project });
    const t = withSourcePlugin(d, target(d), path.join(tmp, "state"))!;
    expect(t.plan.args.slice(0, 2)).toEqual(["run", "dev"]);
    expect(t.plan.args[2]).toBe("--config");
    expect(t.plan.args[3]!.startsWith(path.join(tmp, "state", "wrappers"))).toBe(true);
    expect(fs.readdirSync(project)).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("npm necesita `--` antes de los flags", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cli-src-"));
    const d = det({ projectDir: tmp }, "npm");
    expect(withSourcePlugin(d, target(d), path.join(tmp, "s"))!.plan.args.slice(0, 4)).toEqual(["run", "dev", "--", "--config"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it("no aplica a Vue, Next, --command, estaticos ni --url", () => {
    const skip = (over: Partial<DetectionResult>) => {
      const d = det(over);
      return withSourcePlugin(d, target(d), os.tmpdir());
    };
    expect(skip({ framework: { bundler: "vite", ui: "vue" } })).toBeNull();
    expect(skip({ framework: { runtime: "next", ui: "react" } })).toBeNull();
    expect(skip({ plan: { command: "pnpm", args: ["dev"], cwd: "/p", source: "override" } })).toBeNull();
    expect(skip({ kind: "static" })).toBeNull();
    expect(withSourcePlugin(null, { root: "/p", plan: { command: "", args: [], cwd: "/p" }, url: null }, os.tmpdir())).toBeNull();
  });
});
