import { describe, expect, it } from "vitest";

import { renderMessage } from "./message.js";
import type { T3Message } from "../../types.js";

function message(overrides: Partial<T3Message> & { text: string }): T3Message {
  return {
    id: "m1",
    role: "user",
    turnId: "turn-1",
    streaming: false,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("renderMessage", () => {
  it("renders context image refs", () => {
    const rendered = renderMessage(
      message({
        text: "see ![image.png](t3-context://v1/image/image_abc) ok",
        context: {
          version: 1,
          records: [
            {
              contextId: "image_abc",
              label: "image.png",
              kind: "image",
              attachmentId: "thread-attachment",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 301757,
            },
          ],
        },
      }),
    );
    expect(rendered.text).toBe("see  ok");
    expect(rendered.images).toHaveLength(1);
    expect(rendered.images[0]).toMatchObject({ label: "image.png", attachmentId: "thread-attachment" });
  });

  it("falls back to carried attachments without context records", () => {
    const rendered = renderMessage(
      message({
        text: "what is this",
        attachments: [
          { type: "image", id: "thread-clipboard-1", name: "clipboard-1.png", mimeType: "image/png", sizeBytes: 10244 },
          { type: "file", id: "thread-doc-1", name: "doc.pdf", mimeType: "application/pdf", sizeBytes: 10 },
        ],
      }),
    );
    expect(rendered.text).toBe("what is this");
    expect(rendered.images).toHaveLength(1);
    expect(rendered.images[0]).toMatchObject({ label: "clipboard-1.png", attachmentId: "thread-clipboard-1" });
  });

  it("does not duplicate attachments already covered by refs", () => {
    const rendered = renderMessage(
      message({
        text: "![image.png](t3-context://v1/image/image_abc)",
        context: {
          version: 1,
          records: [
            {
              contextId: "image_abc",
              label: "image.png",
              kind: "image",
              attachmentId: "thread-attachment",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 301757,
            },
          ],
        },
        attachments: [
          { type: "image", id: "thread-attachment", name: "image.png", mimeType: "image/png", sizeBytes: 301757 },
        ],
      }),
    );
    expect(rendered.images).toHaveLength(1);
  });
});
