// MobileSheet.jsx — shared bottom-sheet primitive for the mobile surface.
// Slide-up modal: scrim, grab handle, optional title row + close, scroll body,
// optional pinned footer. Used by every detail/compose/confirm flow across the
// guardian + operator tracks (Pay, Sign, Broadcast, Resolve incident, …).
//
// Themed entirely via the scoped tokens (no hardcoded colour). The scrim renders
// inside the [data-surface="mobile"] subtree so tokens resolve correctly.

import { useEffect } from "react";
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

  return (
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
}
