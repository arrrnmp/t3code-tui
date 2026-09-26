import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";

import { NoticeBanner, type Notice } from "../../ui/noticebanner.js";
import { COLOR } from "../../theme.js";
import { fail } from "../helpers.js";

/**
 * Two notices over the composer share one slot: the first shows with a
 * "1/2" pager, and › moves to the second. One alone shows no pager.
 */
export async function runNoticeBanner(): Promise<void> {
  const notice = (key: string, title: string, action: string): Notice => ({
    key,
    glyph: "◔",
    glyphColor: COLOR.danger,
    title,
    detail: <text fg={COLOR.dim}>{`  about ${key}`}</text>,
    actions: [{ label: action, fg: COLOR.accent, onClick: () => {} }],
  });
  const both = [notice("usage", "Usage limit reached", "Continue at reset"), notice("resume", "Resume with less context", "Compact")];
  let setNotices: ((next: Notice[]) => void) | null = null;
  function Harness() {
    const [notices, set] = useState<Notice[]>(both);
    const [index, setIndex] = useState(0);
    setNotices = set;
    return <NoticeBanner notices={notices} index={index} onPage={setIndex} />;
  }
  const setup = await testRender(<Harness />, { width: 100, height: 5, exitOnCtrlC: false });
  await setup.flush();
  const first = setup.captureCharFrame();
  console.log("--- notice banner: first of two ---");
  console.log(first);
  if (!first.includes("Usage limit reached") || !first.includes("1/2")) fail("notice banner does not page two notices");
  if (first.includes("Resume with less context")) fail("notice banner stacks notices instead of paging them");
  const rows = first.split("\n");
  const row = rows.findIndex((line) => line.includes("1/2"));
  await act(async () => setup.mockMouse.click(rows[row]!.indexOf("1/2") + 5, row));
  await setup.flush();
  const second = setup.captureCharFrame();
  if (!second.includes("Resume with less context") || !second.includes("2/2")) fail("› did not page to the second notice");

  await act(async () => setNotices?.([both[0]!]));
  await setup.flush();
  if (setup.captureCharFrame().includes("1/1")) fail("a lone notice shows a pager");
  // No destroy(), as in bootGate: tearing down a second renderer breaks the shared one.
}
