import { describe, expect, it } from "vitest";

import { describeScheduled, formatScheduleInput, parseScheduleInput } from "../schedule.js";

const now = new Date(2026, 8, 27, 14, 30, 20);
const at = (raw: string) => {
  const parsed = parseScheduleInput(raw, now);
  return parsed.at === null ? parsed.error : formatScheduleInput(parsed.at);
};

describe("scheduling a message", () => {
  it("opens on right now, and reads that back as now", () => {
    expect(formatScheduleInput(now)).toBe("2026-09-27 14:30");
    expect(at(formatScheduleInput(now))).toBe("2026-09-27 14:30");
    expect(at("")).toBe("2026-09-27 14:30");
    expect(at("now")).toBe("2026-09-27 14:30");
  });

  it("reads a local date and time, a bare time, days, and offsets", () => {
    expect(at("2026-10-01 09:05")).toBe("2026-10-01 09:05");
    expect(at("2026-10-01T09:05")).toBe("2026-10-01 09:05");
    expect(at("18:00")).toBe("2026-09-27 18:00");
    // Already past today: tomorrow.
    expect(at("9:00")).toBe("2026-09-28 09:00");
    expect(at("tomorrow 7:15")).toBe("2026-09-28 07:15");
    expect(at("in 30m")).toBe("2026-09-27 15:00");
    expect(at("+2h")).toBe("2026-09-27 16:30");
    expect(at("in 1d")).toBe("2026-09-28 14:30");
  });

  it("refuses what is not a time", () => {
    expect(at("25:00")).toMatch(/not a time of day/);
    expect(at("2026-02-30 10:00")).toMatch(/not a date and time/);
    expect(at("soonish")).toMatch(/Use a date and time/);
  });

  it("names the moment in words", () => {
    expect(describeScheduled(now, now)).toBe("now");
    expect(describeScheduled(new Date(2026, 8, 27, 18, 0), now)).toBe("today 18:00");
    expect(describeScheduled(new Date(2026, 8, 28, 9, 0), now)).toBe("tomorrow 09:00");
    expect(describeScheduled(new Date(2026, 9, 3, 9, 0), now)).toBe("Oct 3 09:00");
  });
});
