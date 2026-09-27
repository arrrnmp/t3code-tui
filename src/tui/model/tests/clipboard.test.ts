import { describe, expect, it } from "vitest";

import { isSshSession } from "../clipboard.js";
import { imageWriteCommand } from "../hostClipboard.js";

describe("isSshSession", () => {
  it("detects ssh and mosh session markers", () => {
    expect(isSshSession({ SSH_CONNECTION: "client 123 server 22" })).toBe(true);
    expect(isSshSession({ SSH_CLIENT: "client 123 22" })).toBe(true);
    expect(isSshSession({ SSH_TTY: "/dev/ttys000" })).toBe(true);
    expect(isSshSession({ MOSH_CONNECTION: "client 123" })).toBe(true);
  });

  it("is false for a local session", () => {
    expect(isSshSession({})).toBe(false);
    expect(isSshSession({ SSH_CONNECTION: "" })).toBe(false);
  });
});

describe("imageWriteCommand", () => {
  it("drives each platform's own tool with argv, never a shell string", () => {
    expect(imageWriteCommand('/tmp/a "b".png', "image/png", "darwin")).toEqual({
      command: "osascript",
      args: ["-e", 'set the clipboard to (read (POSIX file "/tmp/a \\"b\\".png") as «class PNGf»)'],
    });
    expect(imageWriteCommand("/tmp/a.webp", "image/webp", "darwin")).toBeNull();
    expect(imageWriteCommand("/tmp/a.png", "image/png", "linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual({
      command: "wl-copy",
      args: ["--type", "image/png"],
      stdinFile: "/tmp/a.png",
    });
    expect(imageWriteCommand("/tmp/a.png", "image/png", "linux", {})?.command).toBe("xclip");
    expect(imageWriteCommand("C:\\it's.png", "image/png", "win32")?.args[2]).toContain("FromFile('C:\\it''s.png')");
  });
});
