import { handleMessage } from "./handlers";
import { reapplyOnLoad } from "./tabs";

// Listeners SIEMPRE en el nivel superior: MV3 descarga y revive el worker; el estado vive en chrome.storage.
chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  void handleMessage(raw, sender).then(sendResponse);
  return true;
});

// Carga completa de una pestaña: si la capa está apagada se re-aplica (el overlay arranca encendido por defecto).
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status !== "complete") return;
  void reapplyOnLoad(tab).catch(() => undefined);
});
