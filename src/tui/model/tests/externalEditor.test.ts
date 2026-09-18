import { describe, expect, it } from "vitest";

import { defaultEditorCandidates, parseEditorCommand, preferredEditorCommand, resolveEditorCommand } from "../externalEditor.js";

describe("resolveEditorCommand", () => {
  it("prefers VISUAL over EDITOR", () => {
    expect(resolveEditorCommand({ VISUAL: "code --wait", EDITOR: "vi" } as NodeJS.ProcessEnv)).toEqual({
      command: "code",
      args: ["--wait"],
    });
  });

  it("splits EDITOR flags into args", () => {
    expect(resolveEditorCommand({ EDITOR: "emacs -nw" } as NodeJS.ProcessEnv)).toEqual({
      command: "emacs",
      args: ["-nw"],
    });
  });

  it("falls back to vi without env", () => {
    const { command } = resolveEditorCommand({} as NodeJS.ProcessEnv);
    expect(command).toBe(process.platform === "win32" ? "notepad" : "vi");
  });
});

describe("defaultEditorCandidates", () => {
  it("prefers graphical editors on macOS", () => {
    expect(defaultEditorCandidates("darwin")).toEqual(["code --wait", "zed --wait", "open -W -e"]);
  });

  it("uses Notepad on Windows", () => {
    expect(defaultEditorCandidates("win32")).toEqual(["notepad"]);
  });

  it("leaves Linux on vi", () => {
    expect(defaultEditorCandidates("linux")).toEqual(["vi"]);
  });
});

describe("preferredEditorCommand", () => {
  it("uses an explicit EDITOR without checking availability", async () => {
    const exists = async () => {
      throw new Error("must not check");
    };
    await expect(preferredEditorCommand({ EDITOR: "vim" } as NodeJS.ProcessEnv, "darwin", exists)).resolves.toEqual({
      command: "vim",
      args: [],
    });
  });

  it("picks the first available cascade entry", async () => {
    const exists = async (command: string) => command === "zed";
    await expect(preferredEditorCommand({} as NodeJS.ProcessEnv, "darwin", exists)).resolves.toEqual({
      command: "zed",
      args: ["--wait"],
    });
  });

  it("ends on the unchecked final fallback when nothing is available", async () => {
    const exists = async () => false;
    await expect(preferredEditorCommand({} as NodeJS.ProcessEnv, "darwin", exists)).resolves.toEqual({
      command: "open",
      args: ["-W", "-e"],
    });
  });

  it("parses flags into args", () => {
    expect(parseEditorCommand("code --wait")).toEqual({ command: "code", args: ["--wait"] });
  });
});
