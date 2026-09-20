import { describe, expect, it } from "vitest";

import { InstallationVersion, OAUTH_DUMMY_KEY, OauthCallbackPage } from "../shims.js";

describe("opencode plugin shims", () => {
  it("pins the upstream dummy-key and version-fallback values", () => {
    expect(OAUTH_DUMMY_KEY).toBe("opencode-oauth-dummy-key");
    expect(InstallationVersion).toBe("local");
  });

  it("renders self-contained success/error pages", () => {
    const ok = OauthCallbackPage.success({ provider: "ChatGPT" });
    expect(ok).toContain("Authorization successful");
    expect(ok).toContain("ChatGPT");

    const err = OauthCallbackPage.error("boom", { provider: "xAI" });
    expect(err).toContain("Authorization failed");
    expect(err).toContain("boom");
  });

  it("escapes provider names and details", () => {
    const page = OauthCallbackPage.error("<script>alert(1)</script>", { provider: "<b>" });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;");
  });
});
