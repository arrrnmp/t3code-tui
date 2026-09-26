import { useEffect, useState } from "react";

/**
 * Which of the notices over the composer is showing. A notice arriving or
 * leaving resets to the first (most urgent) one.
 */
export function useNoticePager(keys: readonly string[]): { index: number; setIndex: (index: number) => void } {
  const [index, setIndex] = useState(0);
  const signature = keys.join("|");
  useEffect(() => setIndex(0), [signature]);
  return { index, setIndex };
}
