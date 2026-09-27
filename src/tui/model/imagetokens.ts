/**
 * Pasted images live in the draft as `[Image #N]` tokens (Claude Code's
 * form) instead of a chip strip over the composer: the token is the
 * attachment, and deleting it detaches the image. These are the pure parts:
 * numbering new tokens and finding the tokens in a restored draft.
 *
 * opentui's native word wrap breaks after any ASCII bracket and at every
 * space, no-break ones included (`isAsciiWrapBreak` / `unicodeLayoutWrapBreakKind`
 * in its utf8.zig), so no spelling of this token is unbreakable short of
 * lookalike glyphs. We keep the familiar ASCII form; the chip styling keeps
 * it readable as one unit when it does wrap. Older drafts (`[Image N]`,
 * `⟦Image#N⟧`) still parse.
 */

const TOKEN = /\[Image #?(\d+)\]|⟦Image#(\d+)⟧/gu;

function tokenNumber(match: RegExpMatchArray): number {
  return Number(match[1] ?? match[2]);
}

/** The label for the next image: one past the highest number already in use. */
export function nextImageLabel(labels: readonly string[]): string {
  let highest = 0;
  for (const label of labels) {
    for (const match of label.matchAll(TOKEN)) highest = Math.max(highest, tokenNumber(match));
  }
  return `[Image #${highest + 1}]`;
}

export interface ImageTokenSpan {
  name: string;
  label: string;
  start: number;
  end: number;
}

/**
 * A draft restored as plain text (a thread switch) still reads "[Image #1]";
 * pair its tokens, in order, with the attachments still pending, so each
 * gets its token back. Tokens with no attachment left stay plain text;
 * attachments with no token left are returned unpaired for the caller.
 */
export function pairImageTokens(text: string, names: readonly string[]): { paired: ImageTokenSpan[]; unpaired: string[] } {
  const paired: ImageTokenSpan[] = [];
  let next = 0;
  for (const match of text.matchAll(TOKEN)) {
    const name = names[next];
    if (name === undefined || match.index === undefined) break;
    paired.push({ name, label: match[0], start: match.index, end: match.index + match[0].length });
    next += 1;
  }
  return { paired, unpaired: names.slice(next) };
}

/**
 * Pasted text that is moxen's own copy of a prompt: its tokens are
 * renumbered past the ones already in the draft (a second "[Image #1]"
 * would be ambiguous) and paired, in order, with the images attached
 * again for them. Spans are offsets into the returned text.
 */
export function relabelImageTokens(
  text: string,
  names: readonly string[],
  inUse: readonly string[],
): { text: string; spans: ImageTokenSpan[] } {
  const labels = [...inUse];
  const spans: ImageTokenSpan[] = [];
  let out = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const name = names[spans.length];
    if (name === undefined || match.index === undefined) break;
    const label = nextImageLabel(labels);
    labels.push(label);
    out += text.slice(last, match.index);
    spans.push({ name, label, start: out.length, end: out.length + label.length });
    out += label;
    last = match.index + match[0].length;
  }
  return { text: out + text.slice(last), spans };
}
