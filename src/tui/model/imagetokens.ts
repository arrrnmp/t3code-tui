/**
 * Pasted images live in the draft as `[Image N]` tokens instead of a chip
 * strip over the composer: the token is the attachment, and deleting it
 * detaches the image. These are the pure parts: numbering new tokens and
 * finding the tokens in a restored draft.
 */

const TOKEN = /\[Image (\d+)\]/gu;

/** The label for the next image: one past the highest number already in use. */
export function nextImageLabel(labels: readonly string[]): string {
  let highest = 0;
  for (const label of labels) {
    for (const match of label.matchAll(TOKEN)) highest = Math.max(highest, Number(match[1]));
  }
  return `[Image ${highest + 1}]`;
}

export interface ImageTokenSpan {
  name: string;
  label: string;
  start: number;
  end: number;
}

/**
 * A draft restored as plain text (a thread switch) still reads "[Image 1]";
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
