import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

const SEEN_KEY = "iotools:venue-notifs-seen";

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function writeSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// Build the notification list purely from already-loaded venue state — no fetch.
export function buildNotifications(state, pendingBookings = 0) {
  const out = [];
  (state.open_incidents || []).forEach((i) => out.push({
    id: `inc-${i.id}`, tone: i.severity === "critical" ? "crit" : i.severity === "warning" ? "warn" : "info",
    icon: i.severity === "info" ? "info" : "alert",
    title: i.description, sub: `Incident · ${i.severity || "info"}`, tab: "ops",
  }));
  (state.pending_registrations || []).forEach((r) => out.push({
    id: `reg-${r.id}`, tone: "info", icon: "teams",
    title: `${r.team_name || r.team_id} wants to register`, sub: "Awaiting approval", tab: "ops",
  }));
  const unassigned = (state.fixtures?.tonight || []).filter((f) => !f.playing_area_id || !f.official_id);
  unassigned.forEach((f) => out.push({
    id: `unas-${f.id}`, tone: "warn", icon: "alert",
    title: `${state.teams?.[f.home_team_id]?.name || "TBC"} vs ${state.teams?.[f.away_team_id]?.name || "TBC"}`,
    sub: !f.playing_area_id && !f.official_id ? "No pitch or ref" : !f.playing_area_id ? "No pitch assigned" : "No ref assigned",
    tab: "ops",
  }));
  if (pendingBookings > 0) out.push({
    id: `bk-${pendingBookings}`, tone: "info", icon: "bookings",
    title: `${pendingBookings} booking request${pendingBookings === 1 ? "" : "s"} pending`, sub: "Review in Bookings", tab: "bookings",
  });
  return out;
}

export function unseenCount(state, pendingBookings = 0) {
  const seen = readSeen();
  return buildNotifications(state, pendingBookings).filter((n) => !seen.has(n.id)).length;
}

export default function NotificationsPanel({ state, pendingBookings = 0, anchorRect, onClose, onNavigate }) {
  const [seen, setSeen] = useState(() => readSeen());
  const items = useMemo(() => buildNotifications(state, pendingBookings), [state, pendingBookings]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    const onClick = () => onClose?.();
    window.addEventListener("keydown", onKey);
    // close on next outside click (panel stops propagation)
    const t = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", onClick); clearTimeout(t); };
  }, [onClose]);

  const markAllRead = () => {
    const next = new Set(items.map((i) => i.id));
    writeSeen(next); setSeen(next);
  };

  const style = anchorRect
    ? { position: "fixed", top: anchorRect.bottom + 8, right: Math.max(12, window.innerWidth - anchorRect.right), zIndex: 120 }
    : {};

  return createPortal(
    <div className="notifs-panel" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="notifs-head">
        <h3>Notifications</h3>
        <span style={{ flex: 1 }} />
        {items.length > 0 && <button className="btn btn-xs btn-ghost" onClick={markAllRead}>Mark all read</button>}
      </div>
      <div className="notifs-body">
        {items.length === 0 ? (
          <div className="notifs-empty">All clear. Nothing needs you right now.</div>
        ) : (
          <div className="notifs-section">
            {items.map((n) => (
              <button
                key={n.id}
                className={"notif-row" + (seen.has(n.id) ? " read" : "")}
                onClick={() => { onNavigate?.({ tab: n.tab }); onClose?.(); }}
              >
                <span className={"notif-ico notif-ico-" + n.tone}><Icon name={n.icon} size={15} /></span>
                <span className="notif-text">
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-sub">{n.sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
