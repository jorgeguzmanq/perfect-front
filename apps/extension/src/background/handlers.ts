import {
  LayerGetMessageSchema,
  LayerSetMessageSchema,
  MESSAGE_RESPONSE_SCHEMAS,
  PerfectFrontError,
  ProjectOpenMessageSchema,
  ProjectsListMessageSchema,
  toErrorData,
  zodDetails,
  type PerfectFrontErrorData,
  type ToServiceWorkerMessage,
} from "@perfect-front/shared";
import { discoverServers } from "./server";
import { getLayerEnabled, setLayerEnabled } from "./state";
import { applyLayer, openProject } from "./tabs";

export type WorkerResponse = { ok: true; data: unknown } | { ok: false; error: PerfectFrontErrorData };

type Message = Extract<
  ToServiceWorkerMessage,
  { type: "pf/projects.list" | "pf/project.open" | "pf/layer.get" | "pf/layer.set" }
>;

/** Único contrato aceptado: lo que sigue teniendo sentido del protocolo compartido. */
const SCHEMAS = [ProjectsListMessageSchema, ProjectOpenMessageSchema, LayerGetMessageSchema, LayerSetMessageSchema] as const;

function parseMessage(raw: unknown): Message {
  const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
  const schema = SCHEMAS.find((s) => s.shape.type.value === type);
  const parsed = schema?.safeParse(raw);
  if (!parsed?.success) {
    throw new PerfectFrontError("invalid_request", "Mensaje inválido", parsed ? zodDetails(parsed.error) : undefined);
  }
  return parsed.data as Message;
}

async function dispatch(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case "pf/projects.list":
      return { servers: await discoverServers() };
    case "pf/layer.get":
      return { enabled: await getLayerEnabled() };
    case "pf/layer.set":
      await setLayerEnabled(msg.enabled);
      await applyLayer(msg.enabled);
      return { enabled: msg.enabled };
    case "pf/project.open":
      return openProject(await discoverServers(), msg.port, msg.projectId);
  }
}

/** Punto único de entrada: valida remitente, mensaje y respuesta. Nunca lanza. Solo atiende a páginas de la extensión. */
export async function handleMessage(raw: unknown, sender: chrome.runtime.MessageSender): Promise<WorkerResponse> {
  try {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) {
      throw new PerfectFrontError("forbidden_origin", "Remitente no autorizado");
    }
    const msg = parseMessage(raw);
    const data = await dispatch(msg);
    const check = (MESSAGE_RESPONSE_SCHEMAS[msg.type] as { safeParse(v: unknown): { success: boolean } }).safeParse({
      ok: true,
      data,
    });
    if (!check.success) throw new PerfectFrontError("internal_error", "Respuesta interna inválida");
    return { ok: true, data };
  } catch (e) {
    const error = toErrorData(e);
    const type = typeof raw === "object" && raw !== null ? (raw as { type?: unknown }).type : undefined;
    console.error("[perfect-front]", typeof type === "string" ? type : "mensaje", error.code, error.message);
    return { ok: false, error };
  }
}
