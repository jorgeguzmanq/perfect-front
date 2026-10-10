import { useEffect, useRef } from "react";
import type { PerfectFrontEvent } from "@perfect-front/shared";
import { EVENT_TYPES, backoffDelay, parseEvent } from "../lib/events";

export type StreamState = "connecting" | "live" | "reconnecting";

interface Options {
  url: string | null;
  onEvent: (event: PerfectFrontEvent) => void;
  /** Se llama tras (re)conectar: conviene recargar datos por si se perdieron eventos. */
  onOpen?: (isReconnect: boolean) => void;
  onState?: (state: StreamState) => void;
  /** Inyectable en pruebas. */
  createSource?: (url: string) => EventSource;
}

/**
 * SSE con reconexion propia. `EventSource` reintenta solo en cortes de red, pero se rinde ante errores
 * HTTP (p. ej. 429 o reinicio del servidor): en ese caso se cierra y se reabre con backoff exponencial.
 */
export function useEventStream({ url, onEvent, onOpen, onState, createSource }: Options): void {
  const handlers = useRef({ onEvent, onOpen, onState });
  handlers.current = { onEvent, onOpen, onState };

  useEffect(() => {
    if (!url) return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everOpened = false;
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;
      handlers.current.onState?.(everOpened ? "reconnecting" : "connecting");
      const es = (createSource ?? ((u: string) => new EventSource(u)))(url);
      source = es;
      es.onopen = () => {
        attempt = 0;
        handlers.current.onState?.("live");
        handlers.current.onOpen?.(everOpened);
        everOpened = true;
      };
      const listener = (m: MessageEvent<string>): void => {
        const ev = parseEvent(m.data);
        if (ev) handlers.current.onEvent(ev);
      };
      for (const t of EVENT_TYPES) es.addEventListener(t, listener as EventListener);
      es.onerror = () => {
        if (disposed) return;
        handlers.current.onState?.("reconnecting");
        if (es.readyState === 2 /* CLOSED */) {
          es.close();
          timer = setTimeout(connect, backoffDelay(attempt++));
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [url, createSource]);
}
