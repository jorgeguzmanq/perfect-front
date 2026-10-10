import type {
  CollectionInfo,
  CommentStatus,
  HealthResponse,
  MoveCommentRequest,
  ProjectSummary,
  ResolveCommentRequest,
  UpdateCommentRequest,
  VisualComment,
} from "@perfect-front/shared";

/** Solo tipos de shared (sin runtime): los contratos viven alli y aqui no se redefinen. */

export type ErrorCodeName =
  | "invalid_request"
  | "invalid_id"
  | "invalid_collection"
  | "unauthorized"
  | "forbidden_origin"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_version"
  | "invalid_data"
  | "storage_error"
  | "process_error"
  | "internal_error"
  | "network"
  | "bad_response";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCodeName;
  constructor(status: number, code: ErrorCodeName, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  get isConflict(): boolean {
    return this.code === "conflict" || this.status === 409;
  }
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Entrada ilegible reportada por el servidor (campo opcional del listado). */
export interface CorruptEntry {
  collection: string;
  file: string;
  code: string;
  message: string;
}

export interface CommentList {
  comments: VisualComment[];
  corrupt: CorruptEntry[];
}

export type BatchMoveResult =
  | { id: string; ok: true; comment: VisualComment }
  | { id: string; ok: false; error: { code: string; message: string } };

export interface ListQuery {
  collection?: string;
  status?: CommentStatus;
  q?: string;
}

export interface ApiClientOptions {
  token: string | null;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Cabecera de control de conflictos optimista (ver local-server). */
export const EXPECTED_UPDATED_AT_HEADER = "X-PF-Expected-Updated-At";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class ApiClient {
  private readonly token: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** URL del stream SSE. EventSource no admite cabeceras: el servidor acepta `access_token` solo aqui. */
  eventsUrl(): string {
    const q = this.token ? `?access_token=${encodeURIComponent(this.token)}` : "";
    return `${this.baseUrl}/api/events${q}`;
  }

  private async raw(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers["Content-Type"] = "application/json";
    }
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { method: init.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
    } catch {
      throw new ApiError(0, "network", "No se pudo conectar con el servidor local");
    }
  }

  private async fail(res: Response): Promise<never> {
    let code: ErrorCodeName = "internal_error";
    let message = `Error ${res.status}`;
    try {
      const data: unknown = await res.json();
      if (isRecord(data) && isRecord(data.error)) {
        if (typeof data.error.code === "string") code = data.error.code as ErrorCodeName;
        if (typeof data.error.message === "string") message = data.error.message;
      }
    } catch {
      /* cuerpo no JSON: se conserva el mensaje generico */
    }
    throw new ApiError(res.status, code, message);
  }

  private async json(path: string, init?: Parameters<ApiClient["raw"]>[1]): Promise<Record<string, unknown>> {
    const res = await this.raw(path, init);
    if (!res.ok) return this.fail(res);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ApiError(res.status, "bad_response", "Respuesta del servidor no válida");
    }
    if (!isRecord(data) || data.ok !== true) throw new ApiError(res.status, "bad_response", "Respuesta del servidor no válida");
    return data;
  }

  private pick<T>(data: Record<string, unknown>, key: string, check: (v: unknown) => boolean): T {
    const v = data[key];
    if (!check(v)) throw new ApiError(200, "bad_response", "Respuesta del servidor no válida");
    return v as T;
  }

  private comment(data: Record<string, unknown>): VisualComment {
    return this.pick<VisualComment>(data, "comment", (v) => isRecord(v) && typeof v.id === "string" && typeof v.updatedAt === "string");
  }

  private static enc = encodeURIComponent;

  async health(): Promise<HealthResponse> {
    return (await this.json("/api/health")) as unknown as HealthResponse;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.pick(await this.json("/api/projects"), "projects", Array.isArray);
  }

  async startProject(id: string): Promise<void> {
    await this.json(`/api/projects/${ApiClient.enc(id)}/start`, { method: "POST" });
  }

  async stopProject(id: string): Promise<void> {
    await this.json(`/api/projects/${ApiClient.enc(id)}/stop`, { method: "POST" });
  }

  async listComments(projectId: string, query: ListQuery = {}): Promise<CommentList> {
    const params = new URLSearchParams();
    if (query.collection) params.set("collection", query.collection);
    if (query.status) params.set("status", query.status);
    if (query.q) params.set("q", query.q);
    const qs = params.size > 0 ? `?${params}` : "";
    const data = await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments${qs}`, { headers: { "X-PF-Include-Corrupt": "1" } });
    const comments = this.pick<VisualComment[]>(data, "comments", Array.isArray);
    const corrupt = Array.isArray(data.corrupt) ? (data.corrupt as CorruptEntry[]) : [];
    return { comments, corrupt };
  }

  async getComment(projectId: string, id: string): Promise<VisualComment> {
    return this.comment(await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(id)}`));
  }

  /** `expectedUpdatedAt`: si el comentario cambio en el servidor, responde 409 `conflict` sin escribir. */
  async updateComment(projectId: string, id: string, patch: UpdateCommentRequest, expectedUpdatedAt?: string): Promise<VisualComment> {
    const headers = expectedUpdatedAt ? { [EXPECTED_UPDATED_AT_HEADER]: expectedUpdatedAt } : undefined;
    return this.comment(
      await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(id)}`, { method: "PATCH", body: patch, ...(headers ? { headers } : {}) }),
    );
  }

  async moveComment(projectId: string, id: string, to: string): Promise<VisualComment> {
    const body: MoveCommentRequest = { to } as MoveCommentRequest;
    return this.comment(await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(id)}/move`, { method: "POST", body }));
  }

  async moveComments(projectId: string, ids: string[], to: string): Promise<BatchMoveResult[]> {
    const data = await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/move`, { method: "POST", body: { ids, to } });
    return this.pick(data, "results", Array.isArray);
  }

  async resolveComment(projectId: string, id: string, body: ResolveCommentRequest): Promise<VisualComment> {
    return this.comment(await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(id)}/resolve`, { method: "POST", body }));
  }

  async reopenComment(projectId: string, id: string): Promise<VisualComment> {
    return this.comment(await this.json(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(id)}/reopen`, { method: "POST" }));
  }

  async listCollections(projectId: string): Promise<CollectionInfo[]> {
    return this.pick(await this.json(`/api/projects/${ApiClient.enc(projectId)}/collections`), "collections", Array.isArray);
  }

  async createCollection(projectId: string, name: string): Promise<CollectionInfo> {
    return this.pick(await this.json(`/api/projects/${ApiClient.enc(projectId)}/collections`, { method: "POST", body: { name } }), "collection", isRecord);
  }

  /** Captura como Blob (requiere Authorization: no se puede usar como `<img src>` directo). */
  async getAttachment(projectId: string, commentId: string, attachment: string): Promise<Blob> {
    const file = attachment.replace(/^attachments\//, "");
    const res = await this.raw(`/api/projects/${ApiClient.enc(projectId)}/comments/${ApiClient.enc(commentId)}/attachments/${ApiClient.enc(file)}`);
    if (!res.ok) return this.fail(res);
    return res.blob();
  }
}

/** Token de sesion inyectado por el servidor en `<meta name="pf-token">`. */
export function readSessionToken(doc: Document = document): string | null {
  const v = doc.querySelector('meta[name="pf-token"]')?.getAttribute("content")?.trim();
  return v ? v : null;
}
