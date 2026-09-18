import { describe, expect, it } from "vitest";

import { isSshSession } from "./clipboard.js";

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
