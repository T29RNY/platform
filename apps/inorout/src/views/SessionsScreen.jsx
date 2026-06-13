import React, { useEffect, useRef, useState } from "react";
import {
  memberGetSelf, memberListChildren,
  memberListUpcomingSessions, memberRsvpSession, memberGetSessionRsvpBoard,
} from "@platform/core/storage/supabase.js";

// SessionsScreen — member/parent-facing club sessions surface.
// Authenticated gate enforced by App.jsx before mounting.
// Zero-footprint when no member_profile or no active club memberships.

const TYPE_LABEL = { training: "Training", match: "Match", friendly: "Friendly", other: "Other" };

const TYPE_STYLE = {
  training: { background: "rgba(255,255,255,0.06)", color: "var(--t2)" },
  match:    { background: "var(--amber)", color: "rgba(0,0,0,0.9)" },
  friendly: { background: "rgba(96,160,255,0.15)", color: "#60A0FF" },
  other:    { background: "rgba(255,255,255,0.06)", color: "var(--t2)" },
};

const RSVP_STYLE = {
  in:      { background: "rgba(76,175,80,0.15)",  color: "rgba(76,175,80,1)",  label: "Going" },
  out:     { background: "rgba(255,96,96,0.15)",  color: "#FF6060",            label: "Not going" },
  maybe:   { background: "rgba(255,190,60,0.15)", color: "var(--amber)",       label: "Maybe" },
  pending: { background: "rgba(255,255,255,0.06)", color: "var(--t2)",         label: "Pending" },
};

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
};

const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

export default function SessionsScreen({ authUser, memberProfile: memberProfileProp }) {
  const [memberProfile, setMemberProfile] = useState(memberProfileProp ?? undefined);
  const [children, setChildren]           = useState([]);
  const [loading, setLoading]             = useState(!memberProfileProp);

  const [selectedClubId, setSelectedClubId] = useState(null);
  const [sessions, setSessions]             = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [detailSession, setDetailSession] = useState(null);
  const [rsvpBoard, setRsvpBoard]         = useState(null);
  const [boardLoading, setBoardLoading]   = useState(false);

  const [rsvpFor, setRsvpFor]     = useState(null); // null = self; uuid = child profile id
  const [rsvpSaving, setRsvpSaving] = useState(null); // status string while saving
  const isRsvpingRef = useRef(false);

  // Load profile + children on mount (skip profile fetch if prop provided)
  useEffect(() => {
    if (memberProfileProp) {
      const clubs = memberProfileProp.active_clubs ?? [];
      if (clubs.length === 1) setSelectedClubId(clubs[0].club_id);
      memberListChildren().then(r => setChildren(r?.children ?? [])).catch(() => {});
      return;
    }
    let alive = true;
    Promise.all([
      memberGetSelf(),
      memberListChildren().catch(() => null),
    ]).then(([profile, childrenResult]) => {
      if (!alive) return;
      const p = profile?.found ? profile : null;
      setMemberProfile(p);
      setChildren(childrenResult?.children ?? []);
      if (p) {
        const clubs = p.active_clubs ?? [];
        if (clubs.length === 1) setSelectedClubId(clubs[0].club_id);
      }
    }).catch(e => {
      console.error("[sessions] load failed", e);
      if (alive) setMemberProfile(null);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Load sessions when a club is selected
  useEffect(() => {
    if (!selectedClubId) return;
    let alive = true;
    setSessionsLoading(true);
    setSessions([]);
    memberListUpcomingSessions(selectedClubId)
      .then(data => { if (alive) setSessions(data ?? []); })
      .catch(e => { console.error("[sessions] list failed", e); })
      .finally(() => { if (alive) setSessionsLoading(false); });
    return () => { alive = false; };
  }, [selectedClubId]);

  const openDetail = async (session) => {
    setDetailSession(session);
    setRsvpBoard(null);
    setBoardLoading(true);
    try {
      const board = await memberGetSessionRsvpBoard(session.session_id);
      setRsvpBoard(board);
    } catch (e) {
      console.error("[sessions] rsvp board failed", e);
    } finally {
      setBoardLoading(false);
    }
  };

  const handleRsvp = async (sessionId, status) => {
    if (isRsvpingRef.current) return;
    isRsvpingRef.current = true;
    setRsvpSaving(status);
    try {
      await memberRsvpSession(sessionId, status, { forProfileId: rsvpFor });
      setSessions(prev =>
        prev.map(s => s.session_id === sessionId ? { ...s, own_rsvp_status: status } : s)
      );
      if (detailSession?.session_id === sessionId) {
        setDetailSession(prev => ({ ...prev, own_rsvp_status: status }));
        const board = await memberGetSessionRsvpBoard(sessionId);
        setRsvpBoard(board);
      }
    } catch (e) {
      console.error("[sessions] rsvp failed", e);
    } finally {
      setRsvpSaving(null);
      isRsvpingRef.current = false;
    }
  };

  // ── Zero-footprint gates ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
        <p style={{ color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading…</p>
      </div>
    </div>
  );

  if (!memberProfile) return null;

  const activeClubs = memberProfile.active_clubs ?? [];
  if (activeClubs.length === 0) return null;

  const selectedClub = activeClubs.find(c => c.club_id === selectedClubId) ?? null;
  const isManager = (memberProfile.managed_teams ?? []).some(t => t.club_id === selectedClubId);

  return (
    <div style={wrap}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "20px 20px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>
            Sessions
          </div>
          {isManager && (
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              background: "var(--amber)", color: "rgba(0,0,0,0.9)",
              padding: "4px 10px", borderRadius: 20,
              fontFamily: "var(--font-body)",
            }}>
              Manager
            </span>
          )}
        </div>

        {/* Club picker — only shown when member has more than one club */}
        {activeClubs.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {activeClubs.map(club => {
              const active = club.club_id === selectedClubId;
              return (
                <button
                  key={`${club.club_id}:${club.cohort_id}`}
                  onClick={() => setSelectedClubId(club.club_id)}
                  style={{
                    padding: "6px 14px", borderRadius: 20,
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber)" : "transparent",
                    color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                    fontSize: 13, fontFamily: "var(--font-body)",
                    cursor: "pointer", fontWeight: active ? 700 : 400,
                  }}
                >
                  {club.club_name}{club.cohort_name ? ` · ${club.cohort_name}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* Single-club label */}
        {activeClubs.length === 1 && selectedClub && (
          <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 4, fontFamily: "var(--font-body)" }}>
            {selectedClub.club_name}{selectedClub.cohort_name ? ` · ${selectedClub.cohort_name}` : ""}
          </div>
        )}
      </div>

      {/* ── Session list ────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

        {!selectedClubId && (
          <p style={{ color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)", textAlign: "center", marginTop: 32 }}>
            Select a club above to see sessions.
          </p>
        )}

        {selectedClubId && sessionsLoading && (
          <p style={{ color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)", textAlign: "center", marginTop: 32 }}>
            Loading sessions…
          </p>
        )}

        {selectedClubId && !sessionsLoading && sessions.length === 0 && (
          <p style={{ color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)", textAlign: "center", marginTop: 32 }}>
            No upcoming sessions.
          </p>
        )}

        {sessions.map(session => (
          <SessionCard
            key={session.session_id}
            session={session}
            onOpen={() => openDetail(session)}
          />
        ))}
      </div>

      {/* ── Session detail sheet ────────────────────────────────────────── */}
      {detailSession && (
        <SessionDetail
          session={detailSession}
          board={rsvpBoard}
          boardLoading={boardLoading}
          children={children}
          rsvpFor={rsvpFor}
          onRsvpForChange={setRsvpFor}
          rsvpSaving={rsvpSaving}
          onRsvp={handleRsvp}
          onClose={() => { setDetailSession(null); setRsvpBoard(null); }}
          memberProfileId={memberProfile.id}
        />
      )}
    </div>
  );
}

// ── SessionCard ───────────────────────────────────────────────────────────────
function SessionCard({ session, onOpen }) {
  const typeStyle = TYPE_STYLE[session.session_type] ?? TYPE_STYLE.other;
  const rsvpState = RSVP_STYLE[session.own_rsvp_status] ?? null;

  return (
    <div
      onClick={onOpen}
      style={{
        background: "var(--b2)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r)",
        padding: "14px",
        cursor: "pointer",
      }}
    >
      {/* Top row: type badge + RSVP chip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          padding: "3px 8px", borderRadius: 10,
          fontFamily: "var(--font-body)",
          ...typeStyle,
        }}>
          {TYPE_LABEL[session.session_type] ?? session.session_type}
        </span>
        {rsvpState ? (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 10,
            fontFamily: "var(--font-body)",
            background: rsvpState.background, color: rsvpState.color,
          }}>
            {rsvpState.label}
          </span>
        ) : (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 10,
            fontFamily: "var(--font-body)",
            background: "var(--amber)", color: "rgba(0,0,0,0.9)",
          }}>
            RSVP
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: 1.1, marginBottom: 6 }}>
        {session.title}
      </div>

      {/* Date + time */}
      <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", marginBottom: 2 }}>
        {fmtDate(session.scheduled_at)} · {fmtTime(session.scheduled_at)}
        {session.meet_time && ` · Meet ${fmtTime(session.meet_time)}`}
      </div>

      {/* Location / opponent */}
      {session.session_type === "match" && session.opponent_name ? (
        <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>
          vs {session.opponent_name}
          {session.home_away && ` · ${session.home_away === "home" ? "Home" : session.home_away === "away" ? "Away" : "Neutral"}`}
        </div>
      ) : session.location ? (
        <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>
          {session.location}
        </div>
      ) : null}

      {/* Team label */}
      {session.cohort_name && (
        <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 4, opacity: 0.7 }}>
          {session.cohort_name}
        </div>
      )}
    </div>
  );
}

// ── SessionDetail ─────────────────────────────────────────────────────────────
function SessionDetail({ session, board, boardLoading, children, rsvpFor, onRsvpForChange, rsvpSaving, onRsvp, onClose, memberProfileId }) {
  const typeStyle = TYPE_STYLE[session.session_type] ?? TYPE_STYLE.other;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxHeight: "90vh",
        background: "var(--b1)", borderRadius: "var(--r) var(--r) 0 0",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <span style={{
              display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              padding: "3px 8px", borderRadius: 10, marginBottom: 8,
              fontFamily: "var(--font-body)", ...typeStyle,
            }}>
              {TYPE_LABEL[session.session_type] ?? session.session_type}
            </span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1.1 }}>
              {session.title}
            </div>
            <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 6, fontFamily: "var(--font-body)" }}>
              {fmtDate(session.scheduled_at)} · {fmtTime(session.scheduled_at)}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 22, color: "var(--t2)",
            cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0,
          }}>×</button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Session details */}
          {session.meet_time && (
            <InfoRow label="Meet by" value={fmtTime(session.meet_time)} />
          )}
          {session.location && (
            <InfoRow label="Location" value={session.location} />
          )}
          {session.session_type === "match" && session.opponent_name && (
            <InfoRow label="Opponent" value={`${session.opponent_name}${session.home_away ? " · " + (session.home_away === "home" ? "Home" : session.home_away === "away" ? "Away" : "Neutral") : ""}`} />
          )}
          {session.opponent_venue_name && (
            <InfoRow label="Venue" value={session.opponent_venue_name} />
          )}
          {session.opponent_address && (
            <InfoRow label="Address" value={session.opponent_address} />
          )}
          {session.capacity && (
            <InfoRow label="Capacity" value={String(session.capacity)} />
          )}
          {session.notes && (
            <InfoRow label="Notes" value={session.notes} />
          )}

          {/* RSVP for selector — shown when member has children */}
          {children.length > 0 && (
            <div style={{ marginTop: 16, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--t2)", marginBottom: 8, fontFamily: "var(--font-body)" }}>
                RSVPing for
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[{ id: null, name: "Myself" }, ...children.map(c => ({
                  id: c.id,
                  name: [c.first_name, c.last_name].filter(Boolean).join(" "),
                }))].map(p => {
                  const active = rsvpFor === p.id;
                  return (
                    <button
                      key={p.id ?? "self"}
                      onClick={() => onRsvpForChange(p.id)}
                      style={{
                        padding: "6px 14px", borderRadius: 20,
                        border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                        background: active ? "var(--amber)" : "transparent",
                        color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                        fontSize: 13, fontFamily: "var(--font-body)",
                        cursor: "pointer", fontWeight: active ? 700 : 400,
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* RSVP buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 20 }}>
            {["in", "maybe", "out"].map(status => {
              const s = RSVP_STYLE[status];
              const isCurrent = session.own_rsvp_status === status;
              const isSaving = rsvpSaving === status;
              return (
                <button
                  key={status}
                  disabled={!!rsvpSaving}
                  onClick={() => onRsvp(session.session_id, status)}
                  style={{
                    flex: 1, padding: "11px 0",
                    borderRadius: "var(--r-button)",
                    border: `2px solid ${isCurrent ? s.color : "var(--border)"}`,
                    background: isCurrent ? s.background : "transparent",
                    color: isCurrent ? s.color : "var(--t2)",
                    fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)",
                    cursor: rsvpSaving ? "not-allowed" : "pointer",
                    opacity: rsvpSaving && !isSaving ? 0.5 : 1,
                  }}
                >
                  {isSaving ? "…" : s.label}
                </button>
              );
            })}
          </div>

          {/* RSVP board */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--t2)", marginBottom: 12, fontFamily: "var(--font-body)" }}>
            Who's coming
          </div>

          {boardLoading && (
            <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>Loading…</p>
          )}

          {!boardLoading && board && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { key: "in",      label: "Going",     names: board.in },
                { key: "maybe",   label: "Maybe",     names: board.maybe },
                { key: "pending", label: "Pending",   names: board.pending },
                { key: "out",     label: "Not going", names: board.out },
              ].filter(g => g.names?.length > 0).map(group => (
                <div key={group.key}>
                  <div style={{ fontSize: 12, color: "var(--t2)", fontWeight: 600, marginBottom: 4, fontFamily: "var(--font-body)" }}>
                    {group.label} ({group.names.length})
                  </div>
                  <div style={{ fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
                    {group.names.join(", ")}
                  </div>
                </div>
              ))}
              {board.in?.length === 0 && board.maybe?.length === 0 && board.pending?.length === 0 && board.out?.length === 0 && (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>No responses yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "10px 0", borderBottom: "1px solid var(--border-subtle)", gap: 12,
    }}>
      <span style={{ color: "var(--t2)", fontSize: 14, flexShrink: 0, fontFamily: "var(--font-body)" }}>{label}</span>
      <span style={{ fontSize: 14, textAlign: "right", fontFamily: "var(--font-body)", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

const wrap = {
  minHeight: "100dvh",
  background: "var(--bg)",
  color: "var(--t1)",
  fontFamily: "var(--font-body)",
  display: "flex",
  flexDirection: "column",
};
