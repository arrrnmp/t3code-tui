import { useRef, useState } from "react";

import { useHover } from "../../hooks/useHover.js";
import { markModalDismissed } from "../../model/modalDismiss.js";
import { CTRL_C_WINDOW_MS } from "../constants.js";

/**
 * Full-size Ctrl+C confirm: Enter / Ctrl+C again quits, Esc cancels. Also
 * owns the consecutive-Ctrl+C escalation counter (1st press clears the
 * prompt, 2nd opens this menu, 3rd — while it's open — quits).
 */
export function useQuitConfirm(setFocus: (focus: "chat") => void) {
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const quitCancelHover = useHover();
  const quitConfirmHover = useHover();
  const lastCtrlCRef = useRef(0);
  const ctrlCCountRef = useRef(0);

  const closeQuitConfirm = () => {
    setQuitConfirmOpen(false);
    markModalDismissed();
    setFocus("chat");
  };

  const openQuitConfirm = () => setQuitConfirmOpen(true);

  /** Bookkeeping for one Ctrl+C press: returns whether it should escalate
      to opening the quit-confirm menu (2nd press inside the window). */
  const registerCtrlCPress = (): boolean => {
    const at = Date.now();
    if (at - lastCtrlCRef.current > CTRL_C_WINDOW_MS) ctrlCCountRef.current = 0;
    ctrlCCountRef.current += 1;
    lastCtrlCRef.current = at;
    return ctrlCCountRef.current >= 2;
  };

  return {
    quitConfirmOpen,
    quitCancelHover,
    quitConfirmHover,
    openQuitConfirm,
    closeQuitConfirm,
    registerCtrlCPress,
  };
}
