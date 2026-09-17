import { describe, expect, it } from "vitest";

import { detectSkillTrigger, filterSkills, insertSkillMention, marqueeWindow } from "./skills.js";
import type { SkillSummary } from "../../catalog/catalog.js";

function skill(overrides: Partial<SkillSummary> & { name: string }): SkillSummary {
  return {
    description: null,
    displayName: null,
    shortDescription: null,
    enabled: true,
    userInvocationOnly: false,
    userInvocable: true,
    ...overrides,
  };
}

describe("detectSkillTrigger", () => {
  it("opens on a bare $ at the cursor", () => {
    expect(detectSkillTrigger("$", 1)).toEqual({ start: 0, query: "" });
  });

  it("tracks the query as the token grows", () => {
    expect(detectSkillTrigger("$pd", 3)).toEqual({ start: 0, query: "pd" });
  });

  it("requires $ to start the draft or follow whitespace", () => {
    expect(detectSkillTrigger("price$5", 7)).toBeNull();
    expect(detectSkillTrigger("fix the $bug", 12)).toEqual({ start: 8, query: "bug" });
  });

  it("closes once whitespace breaks the token", () => {
    expect(detectSkillTrigger("$pdf tool", 9)).toBeNull();
  });

  it("reads only up to the cursor when it sits mid-token", () => {
    expect(detectSkillTrigger("$pdf please help", 3)).toEqual({ start: 0, query: "pd" });
  });

  it("returns null with no $ nearby", () => {
    expect(detectSkillTrigger("just typing", 4)).toBeNull();
  });
});

describe("filterSkills", () => {
  const skills = [
    skill({ name: "pdf", shortDescription: "PDF tools" }),
    skill({ name: "xlsx", displayName: "Spreadsheets" }),
    skill({ name: "disabled-skill", enabled: false }),
    skill({ name: "agent-only", userInvocable: false }),
  ];

  it("drops disabled and agent-only skills regardless of query", () => {
    expect(filterSkills(skills, "").map((s) => s.name)).toEqual(["pdf", "xlsx"]);
  });

  it("filters by name, display name, or description substring", () => {
    expect(filterSkills(skills, "spread").map((s) => s.name)).toEqual(["xlsx"]);
    expect(filterSkills(skills, "pdf").map((s) => s.name)).toEqual(["pdf"]);
  });
});

describe("marqueeWindow", () => {
  it("returns text unchanged when it already fits", () => {
    expect(marqueeWindow("short", 10, 5)).toBe("short");
  });

  it("slides a width-wide window forward with each tick", () => {
    const text = "abcdefghij";
    expect(marqueeWindow(text, 4, 0)).toBe("abcd");
    expect(marqueeWindow(text, 4, 1)).toBe("bcde");
    expect(marqueeWindow(text, 4, 2)).toBe("cdef");
  });

  it("loops through the gap instead of jump-cutting back to the start", () => {
    const text = "abcdefghij";
    const loop = `${text}   •   `;
    expect(marqueeWindow(text, 4, loop.length)).toBe(marqueeWindow(text, 4, 0));
    expect(marqueeWindow(text, 4, loop.length - 1)).not.toBe(marqueeWindow(text, 4, 0));
  });
});

describe("insertSkillMention", () => {
  it("replaces the $query token in place and reports the new cursor position", () => {
    const result = insertSkillMention("fix the $bu bug", { start: 8, query: "bu" }, "debugger");
    expect(result.text).toBe("fix the $debugger  bug");
    expect(result.cursorOffset).toBe(18);
    expect(result.text.slice(0, result.cursorOffset)).toBe("fix the $debugger ");
  });
});
