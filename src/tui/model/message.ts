import os from "node:os";
import path from "node:path";

import type { T3Message } from "../../types.js";

export interface ImageReference {
  contextId: string;
  label: string;
  attachmentId: string | null;
  sizeBytes: number | null;
  filePath: string | null;
}

export interface RenderedMessage {
  text: string;
  images: ImageReference[];
}

const IMAGE_REFERENCE = /!?\[([^\]]*)\]\(t3-context:\/\/v1\/image\/([^)]+)\)/g;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function attachmentsDir(t3Home?: string): string {
  return path.join(t3Home ?? path.join(os.homedir(), ".t3"), "userdata", "attachments");
}

function extensionFor(mimeType: unknown): string {
  if (typeof mimeType !== "string") return ".png";
  const subtype = mimeType.split("/")[1];
  if (subtype === undefined || subtype.length === 0) return ".png";
  return `.${subtype === "jpeg" ? "jpg" : subtype}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBytes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Messages reference attachments as `![label](t3-context://v1/image/<contextId>)`
 * and carry a `context.records` table mapping that id to an attachment id; the
 * bytes then live under the T3 home as `<attachmentId><ext>`.
 *
 * Inline uploads over `thread.turn.start` persist attachments without context
 * records, so anything in `message.attachments` not already covered by a ref
 * renders as an image row too — otherwise TUI-sent images are invisible in
 * the transcript even though the agent received them.
 */
export function renderMessage(message: T3Message, t3Home?: string): RenderedMessage {
  const records = asRecord(message.context)?.records;
  const table = new Map<string, Record<string, unknown>>();
  if (Array.isArray(records)) {
    for (const entry of records) {
      const record = asRecord(entry);
      const contextId = record?.contextId;
      if (record !== null && typeof contextId === "string") table.set(contextId, record);
    }
  }

  const images: ImageReference[] = [];
  const covered = new Set<string>();
  const text = message.text.replace(IMAGE_REFERENCE, (_match, label: string, contextId: string) => {
    const record = table.get(contextId) ?? null;
    const attachmentId = typeof record?.attachmentId === "string" ? record.attachmentId : null;
    if (attachmentId !== null) covered.add(attachmentId);
    const name = typeof record?.name === "string" ? record.name : label;
    images.push({
      contextId,
      label: name.length > 0 ? name : "image",
      attachmentId,
      sizeBytes: typeof record?.sizeBytes === "number" ? record.sizeBytes : null,
      filePath:
        attachmentId === null
          ? null
          : path.join(attachmentsDir(t3Home), `${attachmentId}${extensionFor(record?.mimeType)}`),
    });
    return "";
  });

  const carried = (message as { attachments?: unknown }).attachments;
  if (Array.isArray(carried)) {
    for (const entry of carried) {
      const attachment = asRecord(entry);
      if (attachment === null || attachment.type !== "image") continue;
      const attachmentId = asString(attachment.id);
      if (attachmentId !== null && covered.has(attachmentId)) continue;
      const name = asString(attachment.name) ?? "image";
      images.push({
        contextId: attachmentId ?? name,
        label: name,
        attachmentId,
        sizeBytes: asBytes(attachment.sizeBytes),
        filePath:
          attachmentId === null
            ? null
            : path.join(attachmentsDir(t3Home), `${attachmentId}${extensionFor(attachment.mimeType)}`),
      });
    }
  }

  return { text: text.replace(/[ \t]+\n/g, "\n").trim(), images };
}

export function formatBytes(value: number | null): string {
  if (value === null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
