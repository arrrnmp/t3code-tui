import { useMemo } from "react";
import { useRenderer } from "@opentui/react";

import { createTuiClipboard } from "../model/clipboard.js";

export function useClipboard(): { copyText: (text: string) => Promise<boolean>; isRemote: () => boolean } {
  const renderer = useRenderer();
  return useMemo(() => createTuiClipboard(renderer), [renderer]);
}
