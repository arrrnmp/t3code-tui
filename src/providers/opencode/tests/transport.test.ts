import { describe, expect, it } from "vitest";

import { newOpencodeMessageId } from "../transport.js";

describe("newOpencodeMessageId", () => {
  it("matches the server's msg_ + 12 hex + 14 base62 format", () => {
    for (let index = 0; index < 50; index += 1) {
      const id = newOpencodeMessageId();
      expect(id.startsWith("msg_")).toBe(true);
      expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    }
    const seen = new Set([newOpencodeMessageId(), newOpencodeMessageId(), newOpencodeMessageId()]);
    expect(seen.size).toBe(3);
  });
});
