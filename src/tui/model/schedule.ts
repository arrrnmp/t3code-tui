/**
 * "When should this message go?" — what the Schedule message prompt
 * accepts, in the user's local time:
 *
 * - `2026-09-27 14:30` (what it opens with: right now), or with a `T`;
 * - `14:30` — today, or tomorrow once that has passed;
 * - `today 14:30`, `tomorrow 9:00`;
 * - `in 30m`, `in 2h`, `+1d`;
 * - `now`, or nothing at all;
 * - any ISO date-time.
 *
 * A time already past is allowed: the message then goes at once.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-09-27 14:30`, local: the prompt's starting value and the shape it reads back. */
export function formatScheduleInput(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function atClock(day: Date, hours: number, minutes: number): Date | null {
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(day);
  at.setHours(hours, minutes, 0, 0);
  return at;
}

export function parseScheduleInput(raw: string, now: Date): { at: Date; error: null } | { at: null; error: string } {
  const text = raw.trim().toLowerCase();
  if (text === "" || text === "now") return { at: now, error: null };
  const relative = /^(?:in\s+|\+)(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)$/u.exec(text);
  if (relative) {
    const unit = relative[2]!.startsWith("m") ? 60_000 : relative[2]!.startsWith("h") ? 3_600_000 : 86_400_000;
    return { at: new Date(now.getTime() + Number(relative[1]) * unit), error: null };
  }
  const dayClock = /^(today|tomorrow)\s+(\d{1,2}):(\d{2})$/u.exec(text);
  if (dayClock) {
    const day = new Date(now);
    if (dayClock[1] === "tomorrow") day.setDate(day.getDate() + 1);
    const at = atClock(day, Number(dayClock[2]), Number(dayClock[3]));
    return at === null ? { at: null, error: "That is not a time of day." } : { at, error: null };
  }
  const clock = /^(\d{1,2}):(\d{2})$/u.exec(text);
  if (clock) {
    const at = atClock(now, Number(clock[1]), Number(clock[2]));
    if (at === null) return { at: null, error: "That is not a time of day." };
    // Earlier today means tomorrow — unless it is this very minute.
    if (at.getTime() < now.getTime() - 60_000) at.setDate(at.getDate() + 1);
    return { at, error: null };
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/u.exec(text);
  if (local) {
    const at = atClock(new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3])), Number(local[4]), Number(local[5]));
    if (at === null || at.getMonth() !== Number(local[2]) - 1) return { at: null, error: "That is not a date and time." };
    return { at, error: null };
  }
  const parsed = Date.parse(raw.trim());
  if (Number.isFinite(parsed)) return { at: new Date(parsed), error: null };
  return { at: null, error: "Use a date and time (2026-09-27 14:30), a time (14:30), or “in 30m”." };
}

/** "today 14:30", "tomorrow 09:00", "Sep 29 14:30" — how the confirmation names the moment. */
export function describeScheduled(at: Date, now: Date): string {
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  if (at.getTime() <= now.getTime() + 30_000) return "now";
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  return `${at.toLocaleString("en-US", { month: "short", day: "numeric" })} ${clock}`;
}
