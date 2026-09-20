/**
 * Typed event bus replacing T3 pushes + provider SSE fan-out.
 *
 * In-process pub/sub with a bounded replay buffer, so the TUI, the CLI,
 * and scheduled senders can subscribe late and still see the same truth.
 * Transport-agnostic: carries `ProviderRuntimeEvent`s today, thread-store
 * lifecycle events from Stage 1 on. See DECOUPLE.md §9.
 */
import type { ProviderRuntimeEvent } from "../providers/spi.js";

export type BackendEvent =
  | ProviderRuntimeEvent
  | {
      readonly type: "backend.thread.changed";
      readonly threadId: string;
      readonly reason: string;
    };

export interface EventSubscriptionOptions<TEvent> {
  /** Replay buffered events (oldest first) before live delivery. */
  readonly replay?: boolean;
  /** Skip events that do not match. Applies to replay and live alike. */
  readonly filter?: (event: TEvent) => boolean;
}

export interface EventBus<TEvent> {
  publish(event: TEvent): void;
  subscribe(
    listener: (event: TEvent) => void,
    options?: EventSubscriptionOptions<TEvent>,
  ): () => void;
  /** Number of events currently held for replay. */
  readonly bufferedCount: number;
  clear(): void;
}

const DEFAULT_BUFFER_SIZE = 500;

export function createEventBus<TEvent>(options?: {
  readonly bufferSize?: number;
}): EventBus<TEvent> {
  const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;
  const buffer: TEvent[] = [];
  const listeners = new Set<(event: TEvent) => void>();

  return {
    publish(event: TEvent): void {
      buffer.push(event);
      while (buffer.length > bufferSize) buffer.shift();
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(
      listener: (event: TEvent) => void,
      subscription?: EventSubscriptionOptions<TEvent>,
    ): () => void {
      if (subscription?.replay === true) {
        for (const event of buffer) {
          if (subscription.filter === undefined || subscription.filter(event)) {
            listener(event);
          }
        }
      }
      if (subscription?.filter === undefined) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
      const filter = subscription.filter;
      const wrapped = (event: TEvent): void => {
        if (filter(event)) listener(event);
      };
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    get bufferedCount(): number {
      return buffer.length;
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}
