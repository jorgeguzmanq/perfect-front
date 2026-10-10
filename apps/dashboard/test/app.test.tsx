// @vitest-environment happy-dom
import fs from "node:fs/promises";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "../src/api/client";
import { App } from "../src/App";
import { HtmlCode } from "../src/components/CommentDetail";
import { BASE, commentInput, makeHarness, type Harness } from "../../../packages/local-server/test/helpers";

// Integracion con la API real (createCore en memoria) y un EventSource simulado.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(m: MessageEvent<string>) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  addEventListener(type: string, fn: (m: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, payload: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, label: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout esperando: ${label}\n${document.body.textContent}`);
    await act(async () => {
      await sleep(15);
    });
  }
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const byText = (sel: string, text: string): HTMLElement | null => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text)) ?? null;
async function click(el: HTMLElement | null): Promise<void> {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => {
    el.click();
  });
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

let root: Root | null = null;
let h: Harness;
let projectId: string;
let api: ApiClient;

beforeEach(async () => {
  FakeEventSource.instances = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`${BASE}/`);
  document.body.innerHTML = '<div id="root"></div>';
  h = await makeHarness();
  projectId = await h.register();
  // Cliente real contra la app Hono en memoria (mismo origen, token de sesion).
  api = new ApiClient({
    token: h.token,
    baseUrl: BASE,
    fetch: ((url: string, init: RequestInit = {}) => h.core.app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), origin: BASE } })) as unknown as typeof fetch,
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

async function create(text: string, route = "/pricing", extra: Record<string, unknown> = {}): Promise<string> {
  const base = commentInput() as { location: Record<string, unknown> };
  const r = await h.json(`/api/projects/${projectId}/comments`, { body: commentInput({ comment: text, location: { ...base.location, route, url: `http://localhost:5173${route}`, html: '<img src=x onerror="alert(1)"><script>window.hacked=1</script>' }, ...extra }) });
  expect(r.status).toBe(201);
  return r.body.comment.id as string;
}

async function mount(): Promise<void> {
  await act(async () => {
    root = createRoot(document.getElementById("root")!);
    root.render(<App api={api} />);
  });
  await waitFor(() => q(".db-comments") !== null, "lista cargada");
}

describe("dashboard con API real", () => {
  it("lista proyectos y comentarios, filtra por busqueda y avisa de JSON corrupto sin romper la lista", async () => {
    await create("Reducir espacio del héroe", "/inicio");
    await create("Botón de compra enorme", "/planes");
    await fs.writeFile(path.join(h.projectRoot, ".perfect-front", "comments", "inbox", "pf_BROKEN12345.json"), "{ roto");
    await mount();
    await waitFor(() => document.querySelectorAll(".db-item").length === 2, "dos comentarios");
    expect(q(".db-project")!.textContent).toContain("2");
    expect(q(".db-warning")!.textContent).toContain("1 archivo de comentario ilegible");

    await type(q<HTMLInputElement>('input[type="search"]')!, "/planes");
    expect(document.querySelectorAll(".db-item")).toHaveLength(1);
    expect(q(".db-item")!.textContent).toContain("Botón de compra");
    await type(q<HTMLInputElement>('input[type="search"]')!, "zzz");
    expect(q(".db-empty")!.textContent).toContain("Ningún comentario coincide");
  });

  it("el detalle muestra el HTML capturado como texto (nunca como marcado)", async () => {
    const id = await create("Con HTML peligroso");
    await mount();
    await click(q(".db-item-main"));
    await waitFor(() => q(".db-detail") !== null, "detalle");
    const code = q("pre.db-code code")!;
    expect(code.textContent).toContain("<script>window.hacked=1</script>");
    expect(code.children).toHaveLength(0);
    expect(q(".db-detail img[src='x']")).toBeNull();
    expect(q(".db-detail script")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
    expect(q(".db-detail")!.textContent).toContain(id);
    expect(window.location.pathname).toBe(`/projects/${projectId}/comments/${id}`);
  });

  it("HtmlCode escapa cualquier cadena", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => createRoot(container).render(<HtmlCode html={'<b onclick="x()">hola</b><iframe src="//evil"></iframe>'} />));
    expect(container.querySelector("b, iframe")).toBeNull();
    expect(container.querySelector("code")!.textContent).toBe('<b onclick="x()">hola</b><iframe src="//evil"></iframe>');
  });

  it("conflicto de edicion entre dos pestanas: se muestra y se ofrece recargar", async () => {
    const id = await create("Texto original");
    await mount();
    await click(q(".db-item-main"));
    await waitFor(() => byText("button", "Editar texto") !== null, "boton editar");
    await click(byText("button", "Editar texto"));
    await type(q<HTMLTextAreaElement>(".db-detail textarea")!, "Mi version desde la pestana A");

    // Pestana B edita el mismo comentario antes de que A guarde.
    const other = await h.json(`/api/projects/${projectId}/comments/${id}`, { method: "PATCH", body: { comment: "Version de la pestana B" } });
    expect(other.status).toBe(200);

    await click(byText("button", "Guardar"));
    await waitFor(() => q(".db-warning[role='alert']") !== null, "aviso de conflicto");
    expect(q(".db-detail")!.textContent).toMatch(/cambió|Conflicto/);
    // Nada se sobrescribio en disco.
    expect((await h.json(`/api/projects/${projectId}/comments/${id}`)).body.comment.comment).toBe("Version de la pestana B");
    expect(byText("button", "Guardar")!.hasAttribute("disabled")).toBe(true);

    await click(byText("button", "Recargar y descartar mi edición"));
    await waitFor(() => q(".db-comment-text")?.textContent === "Version de la pestana B", "texto recargado");
  });

  it("un evento SSE de otra pestana durante la edicion marca conflicto de inmediato", async () => {
    const id = await create("Texto original");
    await mount();
    await click(q(".db-item-main"));
    await waitFor(() => byText("button", "Editar texto") !== null, "boton editar");
    await click(byText("button", "Editar texto"));
    const updated = (await h.json(`/api/projects/${projectId}/comments/${id}`, { method: "PATCH", body: { comment: "Cambio externo" } })).body.comment;
    await act(async () => {
      FakeEventSource.instances[0]!.emit("comment.updated", { type: "comment.updated", at: updated.updatedAt, projectId, comment: updated });
    });
    expect(q(".db-detail")!.textContent).toContain("Conflicto de edición");
    expect(q("[role='status']")!.textContent).toContain("actualizó");
  });

  it("mueve por lote sin duplicados y reporta los que ya estaban en destino", async () => {
    const a = await create("Uno", "/a");
    const b = await create("Dos", "/b");
    await create("Tres", "/c");
    await mount();
    await waitFor(() => document.querySelectorAll(".db-item").length === 3, "tres");
    for (const id of [a, b]) await click(q(`input[aria-label="Seleccionar ${id}"]`));
    const select = q<HTMLSelectElement>(".db-batch select")!;
    await act(async () => {
      select.value = "resolved";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byText(".db-batch button", "Mover"));
    await waitFor(() => (q(".db-notice")?.textContent ?? "").includes("2 movidos a resolved"), "aviso de lote");

    const all = (await h.json(`/api/projects/${projectId}/comments`)).body.comments as Array<{ id: string; collection: string }>;
    expect(all).toHaveLength(3);
    expect(new Set(all.map((c) => c.id)).size).toBe(3);
    expect(all.filter((c) => c.collection === "resolved").map((c) => c.id).sort()).toEqual([a, b].sort());
    const inInbox = await fs.readdir(path.join(h.projectRoot, ".perfect-front", "comments", "inbox"));
    const inResolved = await fs.readdir(path.join(h.projectRoot, ".perfect-front", "comments", "resolved"));
    expect(inInbox).toHaveLength(1);
    expect(inResolved).toHaveLength(2);

    // Repetir hacia la misma coleccion: nada que mover.
    for (const id of [a, b]) await click(q(`input[aria-label="Seleccionar ${id}"]`));
    await act(async () => {
      const s = q<HTMLSelectElement>(".db-batch select")!;
      s.value = "resolved";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byText(".db-batch button", "Mover"));
    expect(q(".db-notice")!.textContent).toContain("ya están en esa colección");
  });

  it("resuelve con formulario validado y reabre; crea colecciones con validacion", async () => {
    const id = await create("Para resolver");
    await mount();
    await click(q(".db-item-main"));
    await waitFor(() => byText("button", "Resolver…") !== null, "boton resolver");
    await click(byText("button", "Resolver…"));
    await click(byText("button", "Marcar como resuelto"));
    expect(q("form[aria-label='Resolver comentario']")!.textContent).toContain("Escribe un resumen");
    await type(q<HTMLTextAreaElement>("form[aria-label='Resolver comentario'] textarea")!, "Arreglado");
    await click(byText("button", "Marcar como resuelto"));
    await waitFor(() => (q(".db-detail")?.textContent ?? "").includes("Resuelto"), "resuelto");
    const stored = (await h.json(`/api/projects/${projectId}/comments/${id}`)).body.comment;
    expect(stored).toMatchObject({ status: "resolved", collection: "resolved", resolution: { summary: "Arreglado" } });
    await click(byText("button", "Reabrir"));
    await waitFor(() => (q(".db-detail")?.textContent ?? "").includes("Pendiente"), "reabierto");

    const input = q<HTMLInputElement>('input[placeholder="Nueva colección"]')!;
    await type(input, "Mala Coleccion!");
    await click(byText("button[type='submit']", "Crear"));
    expect(q(".db-error")!.textContent).toContain("minúsculas");
    await type(input, "diseno");
    await click(byText("button[type='submit']", "Crear"));
    await waitFor(() => byText(".db-filter", "diseno") !== null, "coleccion creada");
    expect((await h.json(`/api/projects/${projectId}/collections`)).body.collections.map((c: { name: string }) => c.name)).toContain("diseno");
  });

  it("teclado: flechas mueven el foco entre comentarios, filtros con aria-pressed y enlace de salto", async () => {
    await create("Uno", "/a");
    await create("Dos", "/b");
    await mount();
    await waitFor(() => document.querySelectorAll(".db-item-main").length === 2, "dos items");
    const items = [...document.querySelectorAll<HTMLButtonElement>(".db-item-main")];
    items[0]!.focus();
    await act(async () => {
      items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[1]);
    await act(async () => {
      items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[0]);

    const pending = byText(".db-filter", "Pendiente")!;
    expect(pending.getAttribute("aria-pressed")).toBe("false");
    await click(pending);
    expect(pending.getAttribute("aria-pressed")).toBe("true");
    expect(q("a.db-skip")!.getAttribute("href")).toBe("#detalle");
    expect(q("main [aria-expanded]")).not.toBeNull();
  });

  it("estado vacio y error recuperable de la API", async () => {
    await mount();
    expect(q(".db-empty")!.textContent).toContain("aún no tiene comentarios");
    await act(async () => root?.unmount());
    root = null;

    let fail = true;
    const flaky = new ApiClient({
      token: h.token,
      baseUrl: BASE,
      fetch: ((url: string, init?: RequestInit) => (fail && String(url).includes("/comments") ? Promise.reject(new TypeError("down")) : h.core.app.request(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: BASE } }))) as unknown as typeof fetch,
    });
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      root = createRoot(document.getElementById("root")!);
      root.render(<App api={flaky} />);
    });
    await waitFor(() => (q(".db-warning[role='alert']")?.textContent ?? "").includes("No se pudieron cargar los comentarios"), "error recuperable");
    fail = false;
    await click(byText("button", "Reintentar"));
    await waitFor(() => (q(".db-empty")?.textContent ?? "").includes("aún no tiene comentarios"), "recuperado");
  });
});
