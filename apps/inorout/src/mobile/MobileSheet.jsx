// MobileSheet.jsx — shared bottom-sheet primitive for the mobile surface.
// Slide-up modal: scrim, grab handle, optional title row + close, scroll body,
// optional pinned footer. Used by every detail/compose/confirm flow across the
// guardian + operator tracks (Pay, Sign, Broadcast, Resolve incident, …).
//
// Themed entirely via the scoped tokens (no hardcoded colour). The scrim renders
// inside the [data-surface="mobile"] subtree so tokens resolve correctly.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import MIcon from "./icons.jsx";

export default function MobileSheet({ title, onClose, footer, children }) {
  // Lock body scroll while the sheet is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Portal to the shell's root-level host (#m-sheet-host, a direct child of
  // .m-app). Sheets are opened from screens rendered INSIDE .m-scroll; on iOS
  // WebKit .m-scroll is a stacking context, which traps the scrim's z-index
  // below the docked nav. Rendering into the root host escapes that, so the
  // scrim (z-index:1000) paints above the tab bar. The host is inside the
  // [data-surface="mobile"] + data-theme wrapper, so scoped tokens still
  // resolve. Read once at mount — the host always exists by the time a sheet
  // opens (post-shell-mount); falls back to inline render if it's ever absent.
  const [host] = useState(() =>
    typeof document !== "undefined" ? document.getElementById("m-sheet-host") : null
  );

  const sheet = (
    <div className="m-sheet-scrim" onClick={onClose}>
      <div
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-sheet-grab" />
        {(title || onClose) && (
          <div className="m-sheet-titlerow">
            <span className="m-sheet-title">{title}</span>
            {onClose && (
              <button className="m-icon-btn" onClick={onClose} aria-label="Close">
                <MIcon name="x" size={18} />
              </button>
            )}
          </div>
        )}
        {/* Body scrolls; footer stays pinned + always visible (a tall form like
            Add-member must never bury its confirm button off the bottom). */}
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-footer">{footer}</div>}
      </div>
    </div>
  );

  return host ? createPortal(sheet, host) : sheet;
}
