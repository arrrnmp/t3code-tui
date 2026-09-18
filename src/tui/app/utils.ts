import type { ScrollBoxRenderable } from "@opentui/core";

/** Arrow keys and page keys scroll whichever pane holds focus. */
export function scrollPane(pane: ScrollBoxRenderable | null, keyName: string): void {
  if (pane === null) return;
  if (keyName === "down") pane.scrollBy(1);
  else if (keyName === "up") pane.scrollBy(-1);
  else if (keyName === "pagedown") pane.scrollBy(Math.max(1, pane.viewport.height - 2));
  else if (keyName === "pageup") pane.scrollBy(-Math.max(1, pane.viewport.height - 2));
  else if (keyName === "home") pane.scrollTo(0);
  else if (keyName === "end") pane.scrollTo(pane.scrollHeight);
}

/** First line of the prompt, matching the CLI handover title. */
export function threadTitle(prompt: string): string {
  const title = prompt.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, " ").trim() || "New thread";
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

export function clock(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "--:--";
  const date = new Date(parsed);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
