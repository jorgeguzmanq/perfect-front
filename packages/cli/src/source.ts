import type { DetectionResult } from "@perfect-front/project-detector";
import { writeWrapperConfig } from "@perfect-front/source-plugin";
import type { Target } from "./process";

export const SOURCE_ACTIVE_MESSAGE = "Ubicacion exacta de archivo: activada (data-pf-src; el proyecto no se modifica)";

/**
 * Proyecto Vite + React con script propio: arranca el dev server con una config envoltorio generada
 * en el state-dir (fuera del proyecto) que anade el plugin de fuente. Nunca escribe en el proyecto.
 * Con `--command`/config explicita, sin React o con Next/Angular no se toca el plan (devuelve null).
 */
export function withSourcePlugin(detection: DetectionResult | null, target: Target, stateDir: string): Target | null {
  if (!detection || detection.kind !== "dev-server" || detection.plan.source !== "script") return null;
  const fw = detection.framework;
  if (!fw || !("bundler" in fw) || fw.bundler !== "vite" || fw.ui !== "react") return null;
  if (!target.plan.command) return null;
  const wrapper = writeWrapperConfig({ stateDir, projectDir: detection.projectDir });
  // En npm, los flags tras `run <script>` necesitan `--`; si el plan no es `run`, se anaden directo.
  const needsDashes = target.plan.command === detection.packageManager.name && detection.packageManager.name === "npm" && target.plan.args[0] === "run";
  const args = [...target.plan.args, ...(needsDashes ? ["--"] : []), "--config", wrapper];
  return { ...target, plan: { ...target.plan, args } };
}
