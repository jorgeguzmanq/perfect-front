export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const STATUS_LABEL = {
  pending: "Pendiente",
  in_progress: "En progreso",
  resolved: "Resuelto",
  ignored: "Ignorado",
  archived: "Archivado",
} as const;

export const PROCESS_LABEL = {
  stopped: "Detenido",
  starting: "Iniciando",
  running: "En ejecución",
  failed: "Con error",
  external: "Externo",
} as const;
