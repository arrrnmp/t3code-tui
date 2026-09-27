import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";

import { Composer } from "../../features/composer/composer.js";
import { fail } from "../helpers.js";

/**
 * A pasted image shows in the draft as an `[Image #N]` token (no chip strip
 * over the composer). Backspace takes the token whole and detaches the
 * image; a second image numbers past the first.
 */
export async function runImageTokens(): Promise<void> {
  const removed: string[] = [];
  let attach: ((name: string) => void) | null = null;
  let claim: ((text: string) => string[] | null) | null = null;
  const COPIED = "compare [Image #1] with [Image #2]";
  function Harness() {
    const [names, setNames] = useState<string[]>([]);
    attach = (name) => setNames((current) => [...current, name]);
    claim = (text) => {
      // Stands in for the app's copy stash: this exact text was moxen's copy.
      if (text !== COPIED) return null;
      const pasted = ["copied-a.png", "copied-b.png"];
      setNames((current) => [...current, ...pasted]);
      return pasted;
    };
    return (
      <Composer
        draft=""
        resetKey="k"
        onInput={() => {}}
        onSubmit={() => {}}
        onEscape={() => {}}
        onFocus={() => {}}
        focused
        placeholder="Message the agent"
        model="Claude Opus 5"
        submitVerb="sends"
        running={false}
        width={80}
        attachments={names}
        onClaimPaste={(text) => claim?.(text) ?? null}
        onAttachmentRemoved={(name) => {
          removed.push(name);
          setNames((current) => current.filter((entry) => entry !== name));
        }}
      />
    );
  }
  const setup = await testRender(<Harness />, { width: 82, height: 10, exitOnCtrlC: false });
  await setup.flush();
  await act(async () => attach?.("clipboard-1.png"));
  await setup.flush();
  await act(async () => attach?.("clipboard-2.png"));
  await setup.flush();
  const two = setup.captureCharFrame();
  console.log("--- composer: image tokens ---");
  console.log(two);
  if (!two.includes("[Image #1] [Image #2]")) fail("pasted images do not show as [Image #N] tokens in the draft");

  // Cursor sits after "[Image #2] ": one backspace eats the space, the next the whole token.
  await act(async () => setup.mockInput.pressBackspace());
  await act(async () => setup.mockInput.pressBackspace());
  await setup.flush();
  const one = setup.captureCharFrame();
  console.log("--- composer: image token deleted ---");
  console.log(one);
  if (one.includes("Image #2")) fail("backspace did not take the image token whole");
  if (removed.join(",") !== "clipboard-2.png") fail(`deleting a token did not detach its image (detached: ${removed.join(",") || "none"})`);
  if (!one.includes("[Image #1]")) fail("the other image's token went with it");

  // Pasting moxen's own copy of a prompt brings its images back: the
  // tokens are renumbered past the one already in the draft, and each is
  // pinned to its image (no extra token is added at the end for them).
  await act(async () => setup.mockInput.pasteBracketedText(COPIED));
  await setup.flush();
  const pasted = setup.captureCharFrame();
  console.log("--- composer: moxen copy pasted back ---");
  console.log(pasted);
  if (!pasted.includes("compare [Image #2] with [Image #3]")) fail("a pasted moxen copy did not renumber its image tokens past the draft's");
  if (pasted.includes("[Image #4]")) fail("a pasted moxen copy's images got tokens twice");
  await act(async () => setup.mockInput.pressBackspace());
  await setup.flush();
  if (!removed.includes("copied-b.png")) fail("a pasted copy's token is not pinned to its image");

  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
