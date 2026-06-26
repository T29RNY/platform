// SwipeRow.jsx — shared swipe-to-approve / swipe-to-decline row for the mobile
// surface (port of the design-handoff m-ops.jsx SwipeRow). Swipe right past the
// threshold to approve, left to decline; the row animates out and fires the
// callback. Used by Operations "Tonight" (registration approvals) and Bookings
// (pitch-booking requests). Inline action buttons can sit inside `children` as a
// tap fallback.

import { useState, useRef } from "react";
import MIcon from "./icons.jsx";

export default function SwipeRow({ children, onApprove, onDecline, disabled }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const start = useRef(null);
  const TH = 84;
  const down = (e) => { if (disabled) return; start.current = e.touches ? e.touches[0].clientX : e.clientX; };
  const move = (e) => { if (start.current == null) return; const x = e.touches ? e.touches[0].clientX : e.clientX; setDx(x - start.current); };
  const up = () => {
    if (start.current == null) return;
    if (dx > TH) finish(true); else if (dx < -TH) finish(false); else setDx(0);
    start.current = null;
  };
  const finish = (approve) => { setGone(true); setDx(approve ? 420 : -420); setTimeout(() => (approve ? onApprove() : onDecline()), 220); };
  const prog = Math.min(1, Math.abs(dx) / TH);
  const side = dx > 0 ? "approve" : "decline";
  return (
    <div style={{ position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: gone ? 0 : 10, height: gone ? 0 : "auto", transition: gone ? "height .24s ease .1s, margin .24s ease .1s" : "none" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: side === "approve" ? "flex-start" : "flex-end", padding: "0 22px", background: side === "approve" ? "var(--ok-soft)" : "var(--live-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: side === "approve" ? "var(--ok-ink)" : "var(--live-ink)", fontWeight: 700, fontSize: 14, transform: `scale(${0.8 + prog * 0.3})`, opacity: prog }}>
          <MIcon name={side === "approve" ? "check" : "x"} size={20} color={side === "approve" ? "var(--ok-ink)" : "var(--live-ink)"} />{side === "approve" ? "Approve" : "Decline"}
        </div>
      </div>
      <div onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}
        style={{ position: "relative", transform: `translateX(${dx}px)`, transition: start.current == null ? "transform .32s cubic-bezier(.2,.9,.3,1.2)" : "none", touchAction: "pan-y" }}>
        {children}
      </div>
    </div>
  );
}
