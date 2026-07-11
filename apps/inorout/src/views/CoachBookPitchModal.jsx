import { useState, useRef, useEffect, useCallback } from "react";
import { X, CheckCircle } from "@phosphor-icons/react";
import {
  clubManagerPitchAvailability,
  clubManagerCreateSession,
} from "@platform/core/storage/supabase.js";

// ── CoachBookPitchModal ─────────────────────────────────────────────────────
// A club-coach self-serve pitch booking sheet, native to the club /hub
// (SessionsScreen). Deliberately NOT the casual AdminView/BookPitchModal — that
// sheet is the gold-theme casual path (searchBookableVenues → book_pitch_adhoc →
// pitch_bookings) and looks foreign here. This one matches CreateSessionModal's
// amber club theme and rides the coach rail:
//   read  → club_manager_pitch_availability  (busy blocks + pitch list for a
//            ground the coach's club is linked to; NO free-slots, NO opening
//            hours — the client computes per-pitch free/busy for the chosen window)
//   write → club_manager_create_session       (already accepts playing_area_id;
//            the occupancy trigger reserves / auto-bumps a worse-ranked incumbent
//            server-side — a real clash throws slot_unavailable, surfaced below).
// MVP scope (PR #2b): empty-slot instant book only, fixed 60-min duration. Variable
// length, booking_origin='coach' provenance, and clash-as-request all arrive with
// PR #3's dedicated club_manager_book_pitch RPC. Entry is dark in prod behind
// VITE_SELF_BOOKING_ENABLED (see SessionsScreen).

// Duration is fixed at the club_session default for the MVP (the create RPC has no
// duration param yet — PR #3 adds it).
const BOOK_MINS = 60;

const TYPE_LABEL = { training: "Training", match: "Match", friendly: "Friendly", other: "Other" };

// Friendly mapping for the create-session RPC error codes a coach can hit.
const ERR = {
  slot_unavailable: "That pitch was just taken — pick another time or pitch.",
  slot_reserved: "That time is reserved for club use — pick another.",
  not_team_admin: "You need to manage this team to book.",
  not_a_manager: "You need to manage this team to book.",
  venue_not_in_club: "That ground isn't linked to your club.",
  auth_required: "Please sign in to book.",
};
const friendlyErr = (e) => ERR[e?.message] || "Couldn't book that pitch — please try again.";

// YYYY-MM-DD from a datetime-local string ("2026-07-15T18:00" → "2026-07-15").
const dayOf = (dt) => (dt ? dt.slice(0, 10) : "");

// Local copies of SessionsScreen's club-theme form primitives so this sheet is
// self-contained and visually native to the club /hub (amber).
function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
      color: "var(--t2)", fontFamily: "var(--font-body)",
    }}>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--b2)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--t1)",
  fontSize: 14, fontFamily: "var(--font-body)",
  padding: "10px 12px", marginTop: 6,
};

const chip = (active) => ({
  padding: "6px 14px", borderRadius: 20, cursor: "pointer",
  border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
  background: active ? "var(--amber)" : "transparent",
  color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
  fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
});

export default function CoachBookPitchModal({ managedTeams = [], clubVenues = [], onBooked, onClose }) {
  const [teamId, setTeamId]           = useState(managedTeams[0]?.team_id ?? null);
  const [venueId, setVenueId]         = useState(clubVenues.length === 1 ? clubVenues[0].venue_id : "");
  const [sessionType, setSessionType] = useState("training");
  const [title, setTitle]             = useState("");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local string

  const [pitches, setPitches]           = useState([]); // [{id, name}]
  const [busyBlocks, setBusyBlocks]     = useState([]); // [{playing_area_id, start, end}]
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [availError, setAvailError]     = useState(null);
  const [selectedPitch, setSelectedPitch] = useState(null); // {id, name}

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const [done, setDone]     = useState(false);
  const isSavingRef = useRef(false);

  const day = dayOf(scheduledAt);

  // Availability read: busy blocks + pitches for the chosen ground on the chosen
  // day. Refetch when team / venue / DAY changes (not on the minute — the whole
  // day's busy set is what we filter the chosen window against).
  const loadAvailability = useCallback((tId, vId, d) => {
    if (!tId || !vId || !d) { setPitches([]); setBusyBlocks([]); return; }
    setLoadingAvail(true); setAvailError(null);
    clubManagerPitchAvailability(tId, vId, d, d)
      .then((res) => {
        setPitches(Array.isArray(res?.pitches) ? res.pitches : []);
        setBusyBlocks(Array.isArray(res?.busy) ? res.busy : []);
      })
      .catch((e) => {
        console.error("[coach-book] availability failed", e);
        setAvailError("Couldn't load availability — try again.");
        setPitches([]); setBusyBlocks([]);
      })
      .finally(() => setLoadingAvail(false));
  }, []);

  useEffect(() => {
    setSelectedPitch(null);
    loadAvailability(teamId, venueId, day);
  }, [teamId, venueId, day, loadAvailability]);

  // Advisory free/busy for the chosen [start, start+60min) window. The DB trigger
  // is the real authority (a genuine clash throws slot_unavailable) — this just
  // stops the coach picking an obviously-taken pitch. Overlap = busyStart < winEnd
  // AND busyEnd > winStart.
  const windowFree = (pitchId) => {
    if (!scheduledAt) return false;
    const winStart = new Date(scheduledAt).getTime();
    if (Number.isNaN(winStart)) return false;
    const winEnd = winStart + BOOK_MINS * 60 * 1000;
    for (const b of busyBlocks) {
      if (b.playing_area_id !== pitchId) continue;
      const bs = new Date(b.start).getTime();
      const be = new Date(b.end).getTime();
      if (bs < winEnd && be > winStart) return false;
    }
    return true;
  };

  // Gate on FRESHNESS too: if the coach changes the time (same day → no refetch)
  // onto a window where the picked pitch is now busy, the pick must stop being
  // bookable — otherwise a stale selection could book a now-taken slot (and the
  // trigger might auto-bump a worse-ranked incumbent rather than cleanly reject).
  const canBook = !!(teamId && venueId && title.trim() && scheduledAt
                     && selectedPitch && windowFree(selectedPitch.id));

  const handleBook = async () => {
    if (isSavingRef.current || !canBook) return;
    isSavingRef.current = true; setSaving(true); setError(null);
    try {
      await clubManagerCreateSession(teamId, {
        title: title.trim(),
        scheduledAt,
        sessionType,
        venueId,
        playingAreaId: selectedPitch.id,
      });
      setDone(true);
      onBooked?.();
    } catch (e) {
      console.error("[coach-book] book pitch failed", e);
      setError(friendlyErr(e));
      // A real clash means our advisory view was stale — refresh it and clear the pick.
      setSelectedPitch(null);
      loadAvailability(teamId, venueId, day);
    } finally {
      setSaving(false); isSavingRef.current = false;
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxHeight: "92vh",
        background: "var(--b1)", borderRadius: "var(--r) var(--r) 0 0",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Book a pitch</div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "var(--t2)", cursor: "pointer",
            padding: "0 4px", lineHeight: 1, display: "flex",
          }}>
            <X size={22} weight="thin" />
          </button>
        </div>

        {done ? (
          /* Success */
          <div style={{ padding: "40px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <CheckCircle size={48} weight="thin" color="var(--amber)" />
            <div style={{ fontSize: 17, fontFamily: "var(--font-body)" }}>Pitch booked</div>
            <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", lineHeight: 1.5, maxWidth: 320 }}>
              It's on the calendar as your team, and your players have been asked if they're in or out.
            </div>
            <button onClick={onClose} style={{
              marginTop: 8, padding: "12px 28px", borderRadius: "var(--r-button)", border: "none",
              background: "var(--amber)", color: "rgba(0,0,0,0.9)",
              fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)", cursor: "pointer",
            }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Team — only when managing multiple teams */}
              {managedTeams.length > 1 && (
                <div>
                  <Label>Team</Label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {managedTeams.map((t) => (
                      <button key={t.team_id} onClick={() => setTeamId(t.team_id)} style={chip(t.team_id === teamId)}>
                        {t.team_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Ground — only when the club is linked to more than one */}
              {clubVenues.length > 1 && (
                <div>
                  <Label>Ground</Label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    {clubVenues.map((v) => (
                      <button key={v.venue_id} onClick={() => setVenueId(v.venue_id)} style={chip(v.venue_id === venueId)}>
                        {v.venue_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Session type */}
              <div>
                <Label>Session type</Label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {["training", "match", "friendly", "other"].map((t) => (
                    <button key={t} onClick={() => setSessionType(t)} style={chip(sessionType === t)}>
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <Label>Title *</Label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={sessionType === "match" ? "e.g. vs City FC" : "e.g. Tuesday training"}
                  style={inputStyle}
                />
              </div>

              {/* Date & time */}
              <div>
                <Label>Date & time *</Label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  style={inputStyle}
                />
                <div style={{ fontSize: 11, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 6 }}>
                  Pitches are booked for {BOOK_MINS} minutes.
                </div>
              </div>

              {/* Available pitches at the chosen window */}
              <div>
                <Label>Available pitches</Label>
                {!venueId || !scheduledAt ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 8 }}>
                    Pick a ground and a date &amp; time to see what's free.
                  </div>
                ) : loadingAvail ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 8 }}>Loading…</div>
                ) : availError ? (
                  <div style={{ fontSize: 13, color: "var(--red, #FF6060)", fontFamily: "var(--font-body)", marginTop: 8 }}>{availError}</div>
                ) : pitches.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 8 }}>
                    No bookable pitches at this ground.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    {pitches.map((p) => {
                      const free = windowFree(p.id);
                      // A pitch is only "active" (amber) while it's still free at the
                      // chosen window — a previously-picked pitch that's since gone busy
                      // reverts to a plain disabled "Busy" tile, not selected-amber.
                      const active = selectedPitch?.id === p.id && free;
                      return (
                        <button
                          key={p.id}
                          disabled={!free}
                          onClick={() => setSelectedPitch(p)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "11px 14px", borderRadius: 8, textAlign: "left",
                            border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                            background: active ? "var(--amber)" : "transparent",
                            color: active ? "rgba(0,0,0,0.9)" : free ? "var(--t1)" : "var(--t3, #666)",
                            fontSize: 14, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                            cursor: free ? "pointer" : "not-allowed", opacity: free ? 1 : 0.6,
                          }}
                        >
                          <span>{p.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 400 }}>{free ? "Free" : "Busy"}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {error && (
                <div style={{ fontSize: 13, color: "var(--red, #FF6060)", fontFamily: "var(--font-body)" }}>{error}</div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: "12px 20px 20px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0,
            }}>
              <button
                onClick={handleBook}
                disabled={saving || !canBook}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: "var(--r-button)", border: "none",
                  background: "var(--amber)", color: "rgba(0,0,0,0.9)",
                  fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)",
                  cursor: saving || !canBook ? "not-allowed" : "pointer",
                  opacity: saving || !canBook ? 0.6 : 1,
                }}
              >
                {saving ? "Booking…" : "Book pitch"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
