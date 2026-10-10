import { z } from "zod";
import { PerfectFrontError } from "@perfect-front/shared";
import type { StaticInfo } from "./static";

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number];

export const ExecutionPlanSchema = z
  .object({
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(500)).max(50),
    cwd: z.string().min(1),
    source: z.enum(["override", "config", "script", "static", "external"]),
  })
  .strict();
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export interface Reason {
  step: "root" | "config" | "package" | "workspace" | "package-manager" | "framework" | "script" | "port" | "url" | "override";
  message: string;
}

export interface DetectOverrides {
  url?: string;
  command?: string;
  port?: number;
  /** HTML estático: ruta relativa de la página a abrir (debe estar en la lista de candidatas). */
  page?: string;
  /** HTML estático: ignora la página recordada y obliga a elegir entre las candidatas. */
  choose?: boolean;
}

export interface DetectOptions {
  cwd: string;
  overrides?: DetectOverrides;
  /** Variables de entorno que influyen en el puerto (PORT de Next). Por defecto ninguna: la detección no lee process.env. */
  env?: { PORT?: string | undefined };
}

/** Framework detectado: bundler (Vite) o runtime con servidor propio (Next.js, Angular). */
export type FrameworkInfo =
  | { bundler: "vite"; ui: "react" | "vue" | "svelte" | null }
  | { runtime: "next"; ui: "react" }
  | { runtime: "angular"; ui: "angular" };

export interface DetectionResult {
  /** Raíz resuelta (donde vive `.perfect-front/`). */
  root: string;
  /** Carpeta de la aplicación (difiere de `root` en workspaces). */
  projectDir: string;
  configPath: string | null;
  name: string;
  /** "static" = carpeta con HTML sin runner conocido; `plan` es un marcador que debe reemplazar quien lo sirva. */
  kind: "dev-server" | "static" | "external";
  /** Datos de la carpeta estática (null salvo `kind: "static"`). */
  static: StaticInfo | null;
  framework: FrameworkInfo | null;
  packageManager: { name: PackageManagerName; version: string | null; source: string };
  plan: ExecutionPlan;
  url: string;
  port: number | null;
  reasons: Reason[];
}

export type DetectionFailure = "root_not_found" | "command_ambiguous" | "framework_unknown" | "invalid_config" | "invalid_command";

const CODE_BY_REASON = {
  root_not_found: "not_found",
  command_ambiguous: "conflict",
  framework_unknown: "invalid_data",
  invalid_config: "invalid_data",
  invalid_command: "invalid_request",
} as const;

/** Error tipado de detección; `reason` distingue casos que comparten código de `shared`. */
export class DetectionError extends PerfectFrontError {
  readonly reason: DetectionFailure;
  constructor(reason: DetectionFailure, message: string, details?: { path: string; message: string }[]) {
    super(CODE_BY_REASON[reason], message, details);
    this.name = "DetectionError";
    this.reason = reason;
  }
}
