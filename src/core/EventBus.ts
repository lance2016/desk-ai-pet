type Listener<Payload> = (payload: Payload) => void;

/** Minimal typed publish/subscribe hub. */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Subscribes to an event and returns a function that unsubscribes. */
  on<Name extends keyof Events>(name: Name, listener: Listener<Events[Name]>): () => void {
    const existing = this.listeners.get(name) ?? new Set<Listener<never>>();
    existing.add(listener as Listener<never>);
    this.listeners.set(name, existing);
    return () => {
      existing.delete(listener as Listener<never>);
    };
  }

  emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void {
    const listeners = this.listeners.get(name);
    if (!listeners) return;
    // Copy first so a listener may unsubscribe while the event is dispatched.
    for (const listener of [...listeners]) {
      (listener as Listener<Events[Name]>)(payload);
    }
  }
}
