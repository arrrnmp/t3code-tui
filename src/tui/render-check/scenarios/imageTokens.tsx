import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";

import { Composer } from "../../features/composer/composer.js";
import { fail } from "../helpers.js";

/**
 * A pasted image shows in the draft as an `[Image N]` token (no chip strip
 * over the composer). Backspace takes the token whole and detaches the
 * image; a second image numbers past the first.
 */
export async function runImageTokens(): Promise<void> {
  const removed: string[] = [];
  let attach: ((name: string) => void) | null = null;
  function Harness() {
    const [names, setNames] = useState<string[]>([]);
    attach = (name) => setNames((current) => [...current, name]);
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
  if (!two.includes("[Image 1] [Image 2]")) fail("pasted images do not show as [Image N] tokens in the draft");

  // Cursor sits after "[Image 2] ": one backspace eats the space, the next the whole token.
  await act(async () => setup.mockInput.pressBackspace());
  await act(async () => setup.mockInput.pressBackspace());
  await setup.flush();
  const one = setup.captureCharFrame();
  console.log("--- composer: image token deleted ---");
  console.log(one);
  if (one.includes("[Image 2") || one.includes("Image 2]")) fail("backspace did not take the image token whole");
  if (removed.join(",") !== "clipboard-2.png") fail(`deleting a token did not detach its image (detached: ${removed.join(",") || "none"})`);
  if (!one.includes("[Image 1]")) fail("the other image's token went with it");
  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
