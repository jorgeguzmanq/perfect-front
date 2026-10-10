import { PerfectFrontError, type RunningServer } from "@perfect-front/shared";
import { findProject, isLoopbackHttp, matchScore } from "../match";
import { setLayerInPage } from "../page-scripts";
import { discoverServers } from "./server";
import { getLayerEnabled } from "./state";

/** Ejecuta `setLayerInPage` en el mundo MAIN de una pestaña. Nunca lanza (pestaña cerrada, sin acceso...). */
async function applyToTab(tabId: number, enabled: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: setLayerInPage, args: [enabled] });
  } catch (e) {
    console.error("[perfect-front] no se pudo aplicar la capa en la pestaña", tabId, e instanceof Error ? e.message : e);
  }
}

/** Aplica la preferencia de inmediato, solo a pestañas cuyo origen coincide con un proyecto registrado. */
export async function applyLayer(enabled: boolean): Promise<void> {
  const servers = await discoverServers();
  if (servers.length === 0) return;
  for (const t of await chrome.tabs.query({})) {
    if (t.id !== undefined && t.url && findProject(servers, t.url)) await applyToTab(t.id, enabled);
  }
}

/** Al terminar de cargar una pestaña de proyecto: si la capa está apagada la re-aplica (el overlay arranca encendido). */
export async function reapplyOnLoad(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !isLoopbackHttp(tab.url)) return;
  if (await getLayerEnabled()) return;
  if (findProject(await discoverServers(), tab.url!)) await applyToTab(tab.id, false);
}

/** Enfoca la pestaña que ya muestra el proyecto o abre una nueva. */
export async function openProject(
  servers: RunningServer[],
  port: number,
  projectId: string,
): Promise<{ tabId: number; created: boolean }> {
  const project = servers.find((s) => s.port === port)?.projects.find((p) => p.id === projectId);
  if (!project) throw new PerfectFrontError("not_found", "El proyecto ya no está en ejecución");
  if (!project.url) throw new PerfectFrontError("not_found", "El proyecto no tiene URL");
  const existing = (await chrome.tabs.query({})).find((t) => t.id !== undefined && t.url && matchScore(project.url, t.url) >= 0);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return { tabId: existing.id, created: false };
  }
  const created = await chrome.tabs.create({ url: project.url, active: true });
  if (created.id === undefined) throw new PerfectFrontError("internal_error", "No se pudo abrir la pestaña");
  return { tabId: created.id, created: true };
}
