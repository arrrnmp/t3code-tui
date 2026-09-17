import type { ReactNode } from "react";

import { markModalDismissed } from "./model/modalDismiss.js";
import { SURFACE } from "./theme.js";

/**
 * Shared chrome for every modal (picker, message actions, command palette,
 * ...): a dimmed full-screen backdrop that closes on click, plus a
 * borderless panel — no border, so modals read as a floating layer over the
 * rounded chat/sidebar/diff panes underneath rather than another bordered box.
 */
export function ModalShell({
  screenWidth,
  screenHeight,
  left,
  top,
  width,
  height,
  onClose,
  children,
}: {
  screenWidth: number;
  screenHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <box style={{ position: "absolute", left: 0, top: 0, width: screenWidth, height: screenHeight, flexDirection: "column", zIndex: 20 }}>
      <box
        style={{ position: "absolute", left: 0, top: 0, width: screenWidth, height: screenHeight }}
        backgroundColor="#000000"
        opacity={0.5}
        onMouseDown={() => {
          markModalDismissed();
          onClose();
        }}
      />
      <box
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          flexDirection: "column",
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          zIndex: 30,
        }}
        backgroundColor={SURFACE.raised}
      >
        {children}
      </box>
    </box>
  );
}
