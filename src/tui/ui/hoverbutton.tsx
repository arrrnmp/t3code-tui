import { useHover } from "../hooks/useHover.js";
import { SURFACE } from "../theme.js";

/**
 * A text button with background hover — the close-menu standard issue: idle
 * blends into its surroundings, hover fills with `SURFACE.hover` (and
 * optionally brightens the label) so disparate buttons feel like one family.
 */
export function HoverButton({
  label,
  fg,
  hoverFg,
  bg,
  hoverBg = SURFACE.hover,
  onClick,
}: {
  label: string;
  fg: string;
  hoverFg?: string;
  bg?: string;
  hoverBg?: string;
  onClick: () => void;
}) {
  const { hovered, handlers } = useHover();
  const resolvedBg = hovered ? hoverBg : bg;
  return (
    <text
      fg={hovered && hoverFg !== undefined ? hoverFg : fg}
      {...(resolvedBg === undefined ? {} : { bg: resolvedBg })}
      selectable={false}
      onMouseDown={onClick}
      {...handlers}
    >
      {label}
    </text>
  );
}
