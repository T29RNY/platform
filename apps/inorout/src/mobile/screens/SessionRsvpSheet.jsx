// SessionRsvpSheet.jsx — shared coach view of a training/social session's availability
// (who's in / out / maybe / no-reply) — the same board the desktop coach sees on
// SessionsScreen, so a coach reads training availability just like a match's. Self-fetching:
// give it a session and it calls the existing memberGetSessionRsvpBoard(sessionId)
// (RPC member_get_session_rsvp_board, mig 299) — member-auth (a coach is a club member;
// same membership_required gate as the session list, shared with desktop). Returns grouped
// first-name lists per status. READ-ONLY (the coach observes; guardians/players set their
// own RSVP via the guardian/member tracks). NO new backend.
//
// Renders through the shared MobileSheet (portals to #m-sheet-host, clears the docked nav).
// Consumers: TeamManagerTraining (More → Training) + TeamManagerTonight (upcoming training).

import { useState, useEffect } from "react";
import { memberGetSessionRsvpBoard } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

// Session scheduled_at is a timestamptz (UTC instant) → convert to viewer-local (matches
// the Training screen's fmtWhen), never a raw read.
function fmtWhen(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    + " · " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// status key → token pair + label. Only in/out/maybe: the session board reader groups
// club_session_rsvps rows, and a member who hasn't responded has NO row (nothing writes
// 'pending'), so a "No reply" bucket would always show 0 and falsely imply everyone
// replied. True no-reply (roster members with no RSVP, as matches compute it) needs a
// roster-aware reader — deferred to the backend follow-up.
const GROUPS = [
  ["in",    { soft: "var(--ok-soft)",   ink: "var(--ok-ink)",   label: "In" }],
  ["out",   { soft: "var(--live-soft)", ink: "var(--live-ink)", label: "Out" }],
  ["maybe", { soft: "var(--amber-soft)", ink: "var(--amber)",   label: "Maybe" }],
];

function CountPill({ tk, n }) {
  return (
    <span style={{
      height: 24, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
      background: tk.soft, color: tk.ink,
    }}>{n}<span style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 600 }}>{tk.label}</span></span>
  );
}

export default function SessionRsvpSheet({ session, onClose }) {
  const sessionId = session?.session_id || session?.id || null;
  const [state, setState] = useState({ loading: true, error: false, board: null });

  useEffect(() => {
    if (!sessionId) { setState({ loading: false, error: true, board: null }); return; }
    let cancelled = false;
    setState({ loading: true, error: false, board: null });
    memberGetSessionRsvpBoard(sessionId)
      .then((b) => { if (!cancelled) setState({ loading: false, error: !b, board: b || null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, board: null }); });
    return () => { cancelled = true; };
  }, [sessionId]);

  const { loading, error, board } = state;
  const title = session?.title || (session?.session_type === "social" ? "Social" : "Training");
  const when = fmtWhen(session?.scheduled_at);
  const listOf = (k) => (Array.isArray(board?.[k]) ? board[k] : []);

  return (
    <MobileSheet title={title} onClose={onClose}>
      {when && <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: -2, marginBottom: 10 }}>{when}</div>}

      {loading && <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading availability…</p>}
      {error && <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load who's available.</p>}

      {board && (
        <>
          {/* count summary — same at-a-glance pills as a match */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
            {GROUPS.map(([k, tk]) => <CountPill key={k} tk={tk} n={listOf(k).length} />)}
          </div>

          {/* who's in each bucket */}
          {GROUPS.map(([k, tk]) => {
            const names = listOf(k);
            if (names.length === 0) return null;
            return (
              <div key={k} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: tk.ink, letterSpacing: "0.02em", marginBottom: 6 }}>
                  {tk.label} · {names.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {names.map((p, i) => (
                    <div key={(p.first_name || "") + i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 2px" }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: 7, flex: "none", display: "flex", alignItems: "center",
                        justifyContent: "center", background: tk.soft, color: tk.ink, fontSize: 10.5, fontWeight: 800,
                      }}>{String(p.first_name || "?").slice(0, 1).toUpperCase()}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{p.first_name || "Player"}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {GROUPS.every(([k]) => listOf(k).length === 0) && (
            <p style={{ color: "var(--ink3)", fontSize: 13.5, marginTop: 12 }}>No responses yet.</p>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0 4px", color: "var(--ink4)", fontSize: 12.5 }}>
            <MIcon name="info" size={13} color="var(--ink4)" /> Players and parents set their own availability.
          </div>
        </>
      )}
    </MobileSheet>
  );
}
