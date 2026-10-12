export interface Signal {
  emit(): void;
  subscribe(listener: () => void): () => void;
}

/** A tiny event emitter for app-wide events such as "session expired". */
export function createSignal(): Signal {
  const listeners = new Set<() => void>();
  return {
    emit() {
      for (const l of Array.from(listeners)) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
