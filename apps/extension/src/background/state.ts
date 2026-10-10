/** Preferencia global de la capa de comentarios (local: sobrevive al reinicio del navegador). Activa por defecto. */
export async function getLayerEnabled(): Promise<boolean> {
  const r = (await chrome.storage.local.get("layerEnabled")) as { layerEnabled?: unknown };
  return typeof r.layerEnabled === "boolean" ? r.layerEnabled : true;
}
export async function setLayerEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ layerEnabled: enabled });
}
