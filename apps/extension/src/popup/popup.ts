import "./popup.css";
import { diagnose, type Diagnosis } from "./diagnose";
import { findProject } from "../match";
import { probeLayer } from "../page-scripts";
import {
  EXTENSION_PROTOCOL_VERSION,
  LayerDataSchema,
  ProjectOpenedDataSchema,
  ProjectsListDataSchema,
  type ProcessState,
  type ProjectSummary,
  type RunningServer,
} from "@perfect-front/shared";

const app = document.getElementById("app") as HTMLElement;

type Resp = { ok: true; data: unknown } | { ok: false; error: { message: string } };

const EMPTY_TEXT = "No hay servidores de Perfect Front. En la carpeta de tu proyecto ejecuta:";

async function send(msg: Record<string, unknown>): Promise<Resp> {
  try {
    return (await chrome.runtime.sendMessage({ v: EXTENSION_PROTOCOL_VERSION, ...msg })) as Resp;
  } catch {
    return { ok: false, error: { message: "El service worker no responde" } };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (props.class) n.className = props.class;
  if (props.text !== undefined) n.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) n.setAttribute(k, v);
  n.append(...children);
  return n;
}

const button = (label: string, onClick: () => void, primary = false) => {
  const b = el("button", { class: `pf-btn pf-focusable${primary ? " pf-btn--primary" : ""}`, text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
};

/** Sección compacta "Esta pestaña" con el motivo concreto. */
function diagnosisBox(d: Diagnosis): HTMLElement {
  const bad = d.kind !== "layer";
  return el(
    "section",
    { class: "box", attrs: { "aria-label": "Esta pestaña" } },
    el("h2", { text: "Esta pestaña" }),
    el("p", { class: bad ? "err" : "muted", text: d.message, attrs: { role: bad ? "alert" : "status" } }),
  );
}

const STATE_LABEL: Record<ProcessState, string> = {
  running: "En ejecución",
  starting: "Iniciando",
  stopped: "Detenido",
  failed: "Con error",
  external: "Externo",
};
const STATE_CHIP: Record<ProcessState, string> = {
  running: "resolved",
  starting: "in_progress",
  stopped: "archived",
  failed: "pending",
  external: "ignored",
};

async function render(error?: string): Promise<void> {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const [listR, layerR] = await Promise.all([send({ type: "pf/projects.list" }), send({ type: "pf/layer.get" })]);
  const servers: RunningServer[] = (listR.ok ? ProjectsListDataSchema.safeParse(listR.data).data?.servers : undefined) ?? [];
  const layerEnabled = (layerR.ok ? LayerDataSchema.safeParse(layerR.data).data?.enabled : undefined) ?? true;
  const here = tab?.url ? findProject(servers, tab.url)?.project.id : undefined;
  const diag = await diagnose({
    servers,
    tabUrl: tab?.url,
    probe: async () => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, world: "MAIN", func: probeLayer });
      return r?.result;
    },
  });

  // Switch global de la capa de comentarios.
  const sw = el("button", {
    class: "switch pf-focusable",
    attrs: { type: "button", role: "switch", "aria-checked": String(layerEnabled), "aria-labelledby": "layer-label" },
  });
  sw.addEventListener("click", () =>
    void (async () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.disabled = true;
      const r = await send({ type: "pf/layer.set", enabled: next });
      void render(r.ok ? undefined : r.error.message);
    })(),
  );
  const nodes: Node[] = [
    el("h1", { text: "Perfect Front" }),
    el("div", { class: "switch-row" }, el("span", { text: "Capa de comentarios", attrs: { id: "layer-label" } }), sw),
  ];

  if (servers.length === 0) {
    nodes.push(
      el(
        "div",
        { class: "box" },
        el("p", { class: "muted", text: EMPTY_TEXT }),
        el("code", { text: "perfect-front" }),
        button("Reintentar", () => void render()),
      ),
    );
  } else {
    const open = async (port: number, p: ProjectSummary) => {
      const r = await send({ type: "pf/project.open", port, projectId: p.id });
      if (r.ok && ProjectOpenedDataSchema.safeParse(r.data).success) window.close();
      else void render(r.ok ? "Respuesta inesperada de la extensión" : r.error.message);
    };
    for (const s of servers) {
      const items = s.projects.map((p) => {
        const current = p.id === here;
        const b = el(
          "button",
          { class: "pf-btn pf-focusable project", attrs: { type: "button", ...(current ? { "aria-current": "true" } : {}) } },
          el("span", { class: "name", text: p.name }),
          el("span", { class: "url", text: p.url ?? "Sin URL" }),
          el(
            "span",
            { class: "row" },
            el("span", { class: `pf-chip pf-chip--${STATE_CHIP[p.processState]}`, text: STATE_LABEL[p.processState] }),
            el("span", { class: "pf-chip pf-chip--pending", text: `${p.pendingCount} pendientes` }),
            ...(current ? [el("span", { class: "pf-chip pf-chip--in_progress", text: "Esta pestaña" })] : []),
          ),
        );
        if (!p.url) b.disabled = true;
        b.addEventListener("click", () => void open(s.port, p));
        return el("li", {}, b);
      });
      nodes.push(
        el("div", { class: "row" }, el("h2", { text: `Servidor en el puerto ${s.port}` }), button("Abrir dashboard", () => void chrome.tabs.create({ url: `http://127.0.0.1:${s.port}/` }).then(() => window.close()))),
        el("ul", {}, ...(items.length ? items : [el("li", { class: "muted", text: "Sin proyectos registrados." })])),
      );
    }
  }
  nodes.splice(2, 0, diagnosisBox(diag));
  if (error) nodes.push(el("p", { class: "err", text: error, attrs: { role: "alert" } }));
  app.replaceChildren(...nodes);
}

void render();
