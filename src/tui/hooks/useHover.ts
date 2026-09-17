import { useState } from "react";

/**
 * OpenTUI has no built-in hover state (only private renderer internals) — every
 * hoverable element tracks its own `onMouseOver`/`onMouseOut` pair. This is that
 * pattern factored out once instead of re-typed per component.
 */
export function useHover(): { hovered: boolean; handlers: { onMouseOver: () => void; onMouseOut: () => void } } {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    handlers: {
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
    },
  };
}
