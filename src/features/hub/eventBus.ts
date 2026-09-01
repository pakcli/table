/**
 * PakCLI Event Bus: Inter-plugin decoupled event communication
 */

type EventHandler<T = any> = (data: T) => void;

export class PakCliEventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  /**
   * Listen to an event from another PakCLI plugin
   */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Remove an event listener
   */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    this.listeners.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all listening PakCLI plugins
   */
  emit<T = any>(event: string, data?: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[PakCliEventBus] Error in event listener for '${event}':`, err);
      }
    });
  }
}

declare global {
  interface Window {
    PakCliEventBus?: PakCliEventBus;
  }
}

// Ensure singleton on window
if (typeof window !== "undefined" && !window.PakCliEventBus) {
  window.PakCliEventBus = new PakCliEventBus();
}

export const eventBus = (typeof window !== "undefined" && window.PakCliEventBus) ? window.PakCliEventBus : new PakCliEventBus();
