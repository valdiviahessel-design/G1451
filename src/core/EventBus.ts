type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used to decouple game systems. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((h) => (h as Handler<Events[K]>)(payload));
  }
}

export type LightingPreset = 'golden' | 'day' | 'night';

export interface GameEvents extends Record<string, unknown> {
  'preset:changed': LightingPreset;
  'loading:progress': { label: string; progress: number };
}

export const events = new EventBus<GameEvents>();
