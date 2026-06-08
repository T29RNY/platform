import React, { useEffect } from "react";
import { createPortal } from "react-dom";

// v2-design modal scaffold. Re-skinned to the new token classes
// (.modal-overlay / .modal / .modal--wide / .modal--xwide) while keeping the
// body portal and the `open` gate the existing venue callers rely on.
//
// Compatible with both call styles:
//   <Modal open={x} onClose={…} footer={…}>      (existing venue views)
//   <Modal onClose={…} foot={…}>                  (ported v2 markup; caller gates render)
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  foot,
  wide,
  xwide,
}) {
  useEffect(() => {
    if (open === false) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (open === false) return null;

  const footContent = foot ?? footer;
  const sizeCls = xwide ? " modal--xwide" : wide ? " modal--wide" : "";

  // Portal to <body>: dashboard panels are Framer-Motion-transformed, and a
  // fixed element inside a transformed ancestor positions against that ancestor,
  // not the viewport — the portal escapes that trapped stacking context.
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={"modal" + sizeCls} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footContent && <div className="modal-foot">{footContent}</div>}
      </div>
    </div>,
    document.body
  );
}
