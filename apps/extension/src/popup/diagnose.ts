import type { RunningServer } from "@perfect-front/shared";
import { parseLayerProbe } from "../local-protocol";
import { findProject, originOf } from "../match";

export type Diagnosis =
  | { kind: "no-servers"; message: string }
  | { kind: "no-project"; message: string; tabOrigin: string | null }
  | { kind: "layer"; message: string; projectName: string; active: boolean }
  | { kind: "no-layer"; message: string; projectName: string };

export interface DiagnoseDeps {
  servers: RunningServer[];
  tabUrl: string | undefined;
  /** Sondea el mundo MAIN de la pestaña (typeof window.__pf, isEnabled, versión); lanza si no hay acceso. */
  probe(): Promise<unknown>;
}

/** Motivo concreto por el que la capa funciona o no en la pestaña activa. */
export async function diagnose(d: DiagnoseDeps): Promise<Diagnosis> {
  if (d.servers.length === 0) {
    return { kind: "no-servers", message: "No hay servidores de Perfect Front en ejecución." };
  }
  const match = d.tabUrl ? findProject(d.servers, d.tabUrl) : undefined;
  if (!match) {
    const tabOrigin = originOf(d.tabUrl);
    return {
      kind: "no-project",
      tabOrigin,
      message: `Esta pestaña (${tabOrigin ?? "sin acceso"}) no es de ningún proyecto. Ábrelo desde la lista para usar la capa.`,
    };
  }
  const projectName = match.project.name;
  const state = parseLayerProbe(await d.probe().catch(() => undefined));
  if (!state?.present) {
    return {
      kind: "no-layer",
      projectName,
      message: "La capa no está cargada: recarga la página o revisa que el proxy esté activo.",
    };
  }
  return {
    kind: "layer",
    projectName,
    active: state.enabled,
    message: `Pertenece a ${projectName}; la capa está ${state.enabled ? "activa" : "apagada"}${state.version ? ` (v${state.version})` : ""}.`,
  };
}
