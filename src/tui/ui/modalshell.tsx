import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { markModalDismissed } from "../model/modalDismiss.js";
import { SURFACE } from "../theme.js";

/**
 * Shared chrome for every modal (picker, message actions, command palette,
 * ...): a dimmed full-screen backdrop that closes on click, plus a
 * borderless panel — no border, so modals read as a floating layer over the
 * rounded chat/sidebar/diff panes underneath rather than another bordered box.
 *
 * Both layers fade in over ~150ms (5×30ms steps) so opens read as a layer
 * arriving, not a pop. Mount-only cost; no loop once settled.
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
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setStep((current) => {
        if (current >= 5) {
          clearInterval(timer);
          return 5;
        }
        return current + 1;
      });
    }, 30);
    return () => clearInterval(timer);
  }, []);
  return (
    <box style={{ position: "absolute", left: 0, top: 0, width: screenWidth, height: screenHeight, flexDirection: "column", zIndex: 20 }}>
      <box
        style={{ position: "absolute", left: 0, top: 0, width: screenWidth, height: screenHeight }}
        backgroundColor="#000000"
        opacity={0.5 * (step / 5)}
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
        opacity={step / 5}
      >
        {children}
      </box>
    </box>
  );
}
