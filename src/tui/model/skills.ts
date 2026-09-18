import type { SkillSummary } from "../../cli/catalog/catalog.js";

export interface SkillTrigger {
  /** Offset of the leading `$` in the full draft text. */
  start: number;
  /** Characters typed after `$`, lowercased for matching. */
  query: string;
}

/**
 * Detects a `$skill-name` token being typed at the cursor, Minecraft/slash-
 * picker style: `$` must sit at the very start of the draft or right after
 * whitespace (so `$5 tip` or an email-like token never falsely triggers),
 * and every character between it and the cursor must be word-ish with no
 * whitespace in between — the moment a space is typed the token is done and
 * the picker closes.
 */
export function detectSkillTrigger(text: string, cursorOffset: number): SkillTrigger | null {
  const offset = Math.max(0, Math.min(cursorOffset, text.length));
  let i = offset;
  while (i > 0 && /[\w-]/.test(text[i - 1]!)) i -= 1;
  if (i === 0 || text[i - 1] !== "$") return null;
  const dollarIndex = i - 1;
  if (dollarIndex > 0 && !/\s/.test(text[dollarIndex - 1]!)) return null;
  return { start: dollarIndex, query: text.slice(i, offset).toLowerCase() };
}

/** Skills a `$` picker may offer: enabled, and not marked agent-only (`userInvocable: false`). */
export function filterSkills(skills: readonly SkillSummary[], query: string): SkillSummary[] {
  const invocable = skills.filter((skill) => skill.enabled && skill.userInvocable);
  if (query.length === 0) return invocable;
  return invocable.filter((skill) =>
    `${skill.displayName ?? skill.name} ${skill.name} ${skill.shortDescription ?? skill.description ?? ""}`
      .toLowerCase()
      .includes(query),
  );
}

/**
 * A `width`-wide sliding window over `text`, advancing one column per `tick`
 * — the marquee for a skill description too long to fit its row. Loops with
 * a `   •   ` gap instead of snapping back, so the wrap reads as continuous
 * scroll rather than a jump cut. Returns `text` unchanged when it already fits.
 */
export function marqueeWindow(text: string, width: number, tick: number): string {
  if (text.length <= width || width <= 0) return text;
  const loop = `${text}   •   `;
  const doubled = loop + loop;
  const offset = ((tick % loop.length) + loop.length) % loop.length;
  return doubled.slice(offset, offset + width);
}

/** Replaces the `$query` token with `$skill-name ` and reports where the cursor lands after it. */
export function insertSkillMention(
  text: string,
  trigger: SkillTrigger,
  skillName: string,
): { text: string; cursorOffset: number } {
  const tokenEnd = trigger.start + 1 + trigger.query.length;
  const before = text.slice(0, trigger.start);
  const after = text.slice(tokenEnd);
  const inserted = `$${skillName} `;
  return { text: `${before}${inserted}${after}`, cursorOffset: before.length + inserted.length };
}
