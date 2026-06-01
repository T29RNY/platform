import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export default function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Render to <body> via a portal. The dashboard panels are animated with
  // Framer Motion, which leaves a `transform` on each panel — and a
  // position:fixed element inside a transformed ancestor is positioned against
  // that ancestor, not the viewport. Without the portal the modal is trapped
  // inside a panel's stacking context and sibling panels bleed through it.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={"modal" + (wide ? " modal-wide" : "")} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
