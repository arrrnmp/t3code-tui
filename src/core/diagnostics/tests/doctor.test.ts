import { describe, expect, it } from "vitest";

import { meetsMinVersion, parseVersionNumber } from "../doctor.js";

describe("opencode version floor", () => {
  it("reads the version out of `opencode --version`", () => {
    expect(parseVersionNumber("opencode v2.0.19")).toBe("2.0.19");
    expect(parseVersionNumber("2.1.0-beta.1")).toBe("2.1.0-beta.1");
    expect(parseVersionNumber("garbage")).toBeNull();
    expect(parseVersionNumber(null)).toBeNull();
  });

  it("accepts v2 and rejects v1 or unparseable output", () => {
    expect(meetsMinVersion("opencode v2.0.19", "2.0.0")).toBe(true);
    expect(meetsMinVersion("2.0.0", "2.0.0")).toBe(true);
    expect(meetsMinVersion("opencode v1.14.19", "2.0.0")).toBe(false);
    expect(meetsMinVersion("nope", "2.0.0")).toBe(false);
    expect(meetsMinVersion(null, "2.0.0")).toBe(false);
  });
});
