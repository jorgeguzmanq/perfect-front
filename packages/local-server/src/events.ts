import type { PerfectFrontEvent } from "@perfect-front/shared";

export type EventListener = (event: PerfectFrontEvent, id: number) => void;

/**
 * Bus en memoria. Los servicios publican SOLO después de que la escritura
 * (filesystem o registro) se confirmó; un listener que falle no afecta al resto.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly closers = new Set<() => void>();
  private seq = 0;
  private closed = false;

  publish(event: PerfectFrontEvent): void {
    const id = ++this.seq;
    for (const l of [...this.listeners]) {
      try {
        l(event, id);
      } catch {
        /* un consumidor roto no debe tumbar la escritura ya confirmada */
      }
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.listeners.size;
  }

  /** Registra un callback que se ejecuta al cerrar el bus (termina los streams SSE). */
  onClose(fn: () => void): () => void {
    if (this.closed) {
      fn();
      return () => undefined;
    }
    this.closers.add(fn);
    return () => this.closers.delete(fn);
  }

  close(): void {
    this.closed = true;
    for (const fn of [...this.closers]) fn();
    this.closers.clear();
    this.listeners.clear();
  }
}
