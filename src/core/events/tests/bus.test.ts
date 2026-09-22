import { describe, expect, it } from "vitest";

import { createEventBus, type BackendEvent } from "../bus.js";

function threadChanged(threadId: string, reason: string): BackendEvent {
  return { type: "backend.thread.changed", threadId, reason };
}

describe("event bus", () => {
  it("delivers published events to subscribers in order", () => {
    const bus = createEventBus<BackendEvent>();
    const seen: BackendEvent[] = [];
    bus.subscribe((event) => {
      seen.push(event);
    });
    bus.publish(threadChanged("t-1", "send"));
    bus.publish(threadChanged("t-1", "settle"));
    expect(seen).toEqual([threadChanged("t-1", "send"), threadChanged("t-1", "settle")]);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = createEventBus<BackendEvent>();
    const seen: BackendEvent[] = [];
    const unsubscribe = bus.subscribe((event) => {
      seen.push(event);
    });
    bus.publish(threadChanged("t-1", "send"));
    unsubscribe();
    bus.publish(threadChanged("t-1", "settle"));
    expect(seen).toEqual([threadChanged("t-1", "send")]);
  });

  it("replays buffered events oldest-first for late subscribers", () => {
    const bus = createEventBus<BackendEvent>();
    bus.publish(threadChanged("t-1", "send"));
    bus.publish(threadChanged("t-2", "send"));
    const seen: BackendEvent[] = [];
    bus.subscribe(
      (event) => {
        seen.push(event);
      },
      { replay: true },
    );
    expect(seen).toEqual([threadChanged("t-1", "send"), threadChanged("t-2", "send")]);
    expect(bus.bufferedCount).toBe(2);
  });

  it("applies filters to replay and live delivery", () => {
    const bus = createEventBus<BackendEvent>();
    bus.publish(threadChanged("t-1", "send"));
    bus.publish(threadChanged("t-2", "settle"));
    const seen: BackendEvent[] = [];
    bus.subscribe((event) => seen.push(event), {
      replay: true,
      filter: (event) => event.type === "backend.thread.changed" && event.threadId === "t-2",
    });
    bus.publish(threadChanged("t-1", "interrupt"));
    bus.publish(threadChanged("t-2", "interrupt"));
    expect(seen.map((event) => event.threadId)).toEqual(["t-2", "t-2"]);
  });

  it("caps the replay buffer at the configured size", () => {
    const bus = createEventBus<BackendEvent>({ bufferSize: 2 });
    bus.publish(threadChanged("t-1", "a"));
    bus.publish(threadChanged("t-2", "b"));
    bus.publish(threadChanged("t-3", "c"));
    expect(bus.bufferedCount).toBe(2);
    const seen: BackendEvent[] = [];
    bus.subscribe((event) => seen.push(event), { replay: true });
    expect(seen.map((event) => event.threadId)).toEqual(["t-2", "t-3"]);
  });

  it("clears buffered events", () => {
    const bus = createEventBus<BackendEvent>();
    bus.publish(threadChanged("t-1", "send"));
    bus.clear();
    expect(bus.bufferedCount).toBe(0);
    const seen: BackendEvent[] = [];
    bus.subscribe((event) => seen.push(event), { replay: true });
    expect(seen).toEqual([]);
  });
});
