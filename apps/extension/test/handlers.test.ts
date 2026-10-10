import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_PROTOCOL_VERSION as v } from "@perfect-front/shared";
import { EXT_ID, installChrome, installServers, type FakeProject } from "./fake-chrome";
import build from "../scripts/build.mjs?raw";
import { probeLayer, setLayerInPage } from "../src/page-scripts";

const setLayer = (tabId: number, enabled: boolean) => [{ target: { tabId }, world: "MAIN", func: expect.any(Function), args: [enabled] }];

const APP = "http://localhost:7788/";
const demo: FakeProject = { id: "p1", name: "Demo", url: "http://127.0.0.1:7788", pendingCount: 3 };
const other: FakeProject = { id: "p2", name: "Otro", url: "http://localhost:6000/app", pendingCount: 0 };
const popup = { id: EXT_ID } as chrome.runtime.MessageSender;
const asTab = (t: object) => t as chrome.tabs.Tab;

type Handlers = typeof import("../src/background/handlers");
type Tabs = typeof import("../src/background/tabs");
let handleMessage: Handlers["handleMessage"];
let tabsMod: Tabs;
async function loadWorker() {
  vi.resetModules(); // simula el reinicio del service worker: ningún estado en memoria (ni caché de descubrimiento)
  ({ handleMessage } = await import("../src/background/handlers"));
  tabsMod = await import("../src/background/tabs");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await loadWorker();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tabs = [
  { id: 7, url: APP, windowId: 1 },
  { id: 8, url: "http://localhost:9999/", windowId: 2 },
  { id: 9, url: "https://example.com/", windowId: 1 },
];

describe("validación de remitente y mensajes", () => {
  it("rechaza remitente ajeno y cualquier remitente con pestaña", async () => {
    installChrome();
    installServers({});
    const msg = { v, type: "pf/layer.get" };
    expect(await handleMessage(msg, { id: "otra-extension" } as chrome.runtime.MessageSender)).toMatchObject({ ok: false, error: { code: "forbidden_origin" } });
    const fromTab = { id: EXT_ID, tab: { id: 1 } } as chrome.runtime.MessageSender;
    expect(await handleMessage(msg, fromTab)).toMatchObject({ ok: false, error: { code: "forbidden_origin" } });
  });

  it("rechaza mensajes inválidos y los tipos retirados del protocolo", async () => {
    installChrome();
    installServers({});
    const bad = [
      null,
      "x",
      { v: 2, type: "pf/layer.get" },
      { v, type: "pf/nope" },
      { v, type: "pf/comment.create" },
      { v, type: "pf/capture.request" },
      { v, type: "pf/overlay.set", enabled: true },
      { v, type: "pf/context.get", url: APP },
      { v, type: "pf/project.open", port: 80, projectId: "p1" },
      { v, type: "pf/layer.set", enabled: "si" },
    ];
    for (const b of bad) {
      expect(await handleMessage(b, popup)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    }
  });
});

describe("descubrimiento", () => {
  it("encuentra varios servidores en paralelo, sin credenciales", async () => {
    installChrome();
    const srv = installServers({ 45800: [demo], 45807: [other] });
    const r = await handleMessage({ v, type: "pf/projects.list" }, popup);
    expect(r).toMatchObject({
      ok: true,
      data: { servers: [{ port: 45800, projects: [{ id: "p1" }] }, { port: 45807, projects: [{ id: "p2" }] }] },
    });
    expect(srv.calls.some((c) => c.url.endsWith(":45820/api/health"))).toBe(true);
    expect(srv.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("sin servidores: lista vacía", async () => {
    installChrome();
    installServers({});
    expect(await handleMessage({ v, type: "pf/projects.list" }, popup)).toEqual({ ok: true, data: { servers: [] } });
  });

  it("cachea el resultado un instante", async () => {
    installChrome();
    const srv = installServers({ 45800: [demo] });
    await handleMessage({ v, type: "pf/projects.list" }, popup);
    const n = srv.fetch.mock.calls.length;
    await handleMessage({ v, type: "pf/projects.list" }, popup);
    expect(srv.fetch.mock.calls.length).toBe(n);
    vi.advanceTimersByTime(2500);
    await handleMessage({ v, type: "pf/projects.list" }, popup);
    expect(srv.fetch.mock.calls.length).toBeGreaterThan(n);
  });
});

describe("capa de comentarios (switch)", () => {
  it("activa por defecto, persiste y se aplica por executeScript MAIN solo a pestañas de proyecto", async () => {
    const { chrome, local } = installChrome({ tabs });
    installServers({ 45800: [demo] });
    expect(await handleMessage({ v, type: "pf/layer.get" }, popup)).toEqual({ ok: true, data: { enabled: true } });
    expect(await handleMessage({ v, type: "pf/layer.set", enabled: false }, popup)).toEqual({ ok: true, data: { enabled: false } });
    expect(local.data["layerEnabled"]).toBe(false);
    // Solo la pestaña 7 es de un proyecto: nada para la 8 (origen sin proyecto) ni la 9 (externa).
    expect(chrome.scripting.executeScript.mock.calls).toEqual([setLayer(7, false)]);

    await loadWorker(); // reinicio: la preferencia sigue
    expect(await handleMessage({ v, type: "pf/layer.get" }, popup)).toEqual({ ok: true, data: { enabled: false } });
    chrome.scripting.executeScript.mockClear();
    await handleMessage({ v, type: "pf/layer.set", enabled: true }, popup);
    expect(chrome.scripting.executeScript.mock.calls).toEqual([setLayer(7, true)]);
  });

  it("sin servidores no ejecuta nada en las pestañas", async () => {
    const { chrome } = installChrome({ tabs });
    installServers({});
    await handleMessage({ v, type: "pf/layer.set", enabled: false }, popup);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("un fallo de executeScript en una pestaña no impide las demás ni la respuesta", async () => {
    const two = [...tabs, { id: 10, url: "http://127.0.0.1:7788/b", windowId: 1 }];
    const { chrome } = installChrome({ tabs: two });
    installServers({ 45800: [demo] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    chrome.scripting.executeScript.mockRejectedValueOnce(new Error("Cannot access"));
    expect(await handleMessage({ v, type: "pf/layer.set", enabled: false }, popup)).toEqual({ ok: true, data: { enabled: false } });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("al cargar una pestaña de proyecto con la capa apagada se re-aplica; encendida, no hace nada", async () => {
    const { chrome, local } = installChrome({ tabs });
    installServers({ 45800: [demo] });
    await tabsMod.reapplyOnLoad(asTab(tabs[0]!));
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

    local.data["layerEnabled"] = false;
    await tabsMod.reapplyOnLoad(asTab(tabs[1]!)); // origen sin proyecto
    await tabsMod.reapplyOnLoad(asTab(tabs[2]!)); // externa
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    await tabsMod.reapplyOnLoad(asTab({ id: 30, url: "http://localhost:7788/otra", windowId: 1 })); // host equivalente
    expect(chrome.scripting.executeScript.mock.calls).toEqual([setLayer(30, false)]);
  });
});

describe("funciones del mundo MAIN", () => {
  const win = (pf?: unknown) => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { __pf: pf });
    vi.stubGlobal("localStorage", {
      setItem: (k: string, val: string) => store.set(k, val),
      removeItem: (k: string) => store.delete(k),
    });
    return store;
  };

  it("setLayerInPage escribe pf:layer y llama a disable/enable si existe __pf", () => {
    const pf = { enable: vi.fn(), disable: vi.fn() };
    const store = win(pf);
    expect(setLayerInPage(false)).toBe(true);
    expect(store.get("pf:layer")).toBe("off");
    expect(pf.disable).toHaveBeenCalled();
    expect(setLayerInPage(true)).toBe(true);
    expect(store.has("pf:layer")).toBe(false);
    expect(pf.enable).toHaveBeenCalled();
  });

  it("sin __pf solo persiste la preferencia", () => {
    const store = win();
    expect(setLayerInPage(false)).toBe(false);
    expect(store.get("pf:layer")).toBe("off");
  });

  it("probeLayer informa typeof, isEnabled y versión", () => {
    win({ version: "1.2.3", isEnabled: () => true });
    expect(probeLayer()).toEqual({ present: true, enabled: true, version: "1.2.3" });
    win();
    expect(probeLayer()).toEqual({ present: false, enabled: false, version: null });
  });
});

describe("project.open", () => {
  it("enfoca la pestaña existente en su ventana", async () => {
    const { chrome } = installChrome({ tabs: [{ id: 20, url: "http://localhost:6000/app/dash", windowId: 2 }, ...tabs] });
    installServers({ 45800: [demo], 45801: [other] });
    const r = await handleMessage({ v, type: "pf/project.open", port: 45801, projectId: "p2" }, popup);
    expect(r).toEqual({ ok: true, data: { tabId: 20, created: false } });
    expect(chrome.tabs.update).toHaveBeenCalledWith(20, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("enfoca una pestaña con host equivalente (127.0.0.1 vs localhost)", async () => {
    const { chrome } = installChrome({ tabs: [{ id: 22, url: "http://127.0.0.1:6000/cualquier.html", windowId: 3 }] });
    installServers({ 45801: [other] });
    const r = await handleMessage({ v, type: "pf/project.open", port: 45801, projectId: "p2" }, popup);
    expect(r).toEqual({ ok: true, data: { tabId: 22, created: false } });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it("crea una pestaña con la URL del proxy si no hay ninguna con ese origen", async () => {
    const { chrome } = installChrome({ tabs: [{ id: 21, url: "http://localhost:7000/otra", windowId: 2 }] });
    installServers({ 45801: [other] });
    const r = await handleMessage({ v, type: "pf/project.open", port: 45801, projectId: "p2" }, popup);
    expect(r).toEqual({ ok: true, data: { tabId: 100, created: true } });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "http://localhost:6000/app", active: true });
  });

  it("proyecto desconocido: not_found", async () => {
    installChrome();
    installServers({ 45800: [demo] });
    const r = await handleMessage({ v, type: "pf/project.open", port: 45800, projectId: "nope" }, popup);
    expect(r).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("sin inyección ni content script", () => {
  const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("el manifest generado no declara content_scripts ni web_accessible_resources y los permisos son mínimos", () => {
    expect(build).not.toMatch(/content_scripts|web_accessible_resources|content\.js/);
    expect(build).toContain('permissions: ["storage", "scripting"]');
    expect(build).toContain('host_permissions: ["http://localhost/*", "http://127.0.0.1/*"]');
  });

  it("no existe src/content y ninguna ruta del código inyecta archivos ni usa mensajes de capa/captura", () => {
    expect(Object.keys(sources).some((f) => f.includes("/content/"))).toBe(false);
    for (const [f, code] of Object.entries(sources)) {
      expect(code, f).not.toMatch(/files:\s*\[|content\.js|tabs\.sendMessage|captureVisibleTab|pf\/overlay\.set|pf\/comment\.create/);
    }
  });
});
