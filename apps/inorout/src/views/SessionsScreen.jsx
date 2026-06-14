import React, { useEffect, useRef, useState } from "react";
import {
  memberGetSelf, memberListChildren,
  memberListUpcomingSessions, memberRsvpSession, memberGetSessionRsvpBoard,
  clubManagerCreateSession, clubManagerCreateSessionSeries, clubManagerCancelSession,
  clubManagerGetTeamMembers, clubManagerAddSessionGuest, clubManagerRemoveSessionGuest,
  clubManagerMarkAttendance,
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

// day_of_week: 0=Sun … 6=Sat (matches EXTRACT(DOW))
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const [rsvpFor, setRsvpFor]       = useState(null); // null = self; uuid = child profile id
  const [rsvpSaving, setRsvpSaving] = useState(null); // status string while saving
  const isRsvpingRef = useRef(false);

  // Manager write state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLoading, setCreateLoading]     = useState(false);
  const [teamMembers, setTeamMembers]         = useState([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);
  const isCreatingRef       = useRef(false);
  const isCancellingRef     = useRef(false);
  const isGuestActingRef    = useRef(false);
  const isMarkingAttendanceRef = useRef(false);

  // attendance state: { [sessionId]: { [profileId]: status } }
  const [attendanceMaps, setAttendanceMaps] = useState({});
  const [attendanceSaving, setAttendanceSaving] = useState(false);

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
    setTeamMembers([]);
    setTeamMembersLoading(false);
    try {
      const board = await memberGetSessionRsvpBoard(session.session_id);
      setRsvpBoard(board);
    } catch (e) {
      console.error("[sessions] rsvp board failed", e);
    } finally {
      setBoardLoading(false);
    }
    // Load team members for guest picker if manager of this session's team
    const myTeams = (memberProfile?.managed_teams ?? []).filter(t => t.club_id === selectedClubId);
    if (session.team_id && myTeams.some(t => t.team_id === session.team_id)) {
      setTeamMembersLoading(true);
      try {
        const members = await clubManagerGetTeamMembers(session.team_id, session.session_id);
        setTeamMembers(members ?? []);
      } catch (e) {
        console.error("[sessions] team members failed", e);
      } finally {
        setTeamMembersLoading(false);
      }
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

  const reloadSessions = async () => {
    if (!selectedClubId) return;
    try {
      const data = await memberListUpcomingSessions(selectedClubId);
      setSessions(data ?? []);
    } catch (e) {
      console.error("[sessions] reload failed", e);
    }
  };

  const handleCreateSession = async ({ teamId, title, sessionType, scheduledAt,
    location, notes, capacity, meetTime, opponentName, homeAway, opponentVenueName, opponentAddress }) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setCreateLoading(true);
    try {
      await clubManagerCreateSession(teamId, {
        title, scheduledAt, sessionType, location, notes, capacity,
        meetTime, opponentName, homeAway, opponentVenueName, opponentAddress,
      });
      setShowCreateModal(false);
      await reloadSessions();
    } catch (e) {
      console.error("[sessions] create session failed", e);
    } finally {
      setCreateLoading(false);
      isCreatingRef.current = false;
    }
  };

  const handleCreateSeries = async ({ teamId, title, sessionType, dayOfWeek, startTime, fromDate, toDate, location, notes, capacity }) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setCreateLoading(true);
    try {
      await clubManagerCreateSessionSeries(teamId, {
        title, sessionType, dayOfWeek, startTime, fromDate, toDate, location, notes, capacity,
      });
      setShowCreateModal(false);
      await reloadSessions();
    } catch (e) {
      console.error("[sessions] create series failed", e);
    } finally {
      setCreateLoading(false);
      isCreatingRef.current = false;
    }
  };

  const handleCancelSession = async (sessionId, reason) => {
    if (isCancellingRef.current) return;
    isCancellingRef.current = true;
    try {
      await clubManagerCancelSession(sessionId, reason || null);
      await reloadSessions();
      setDetailSession(null);
      setRsvpBoard(null);
      setTeamMembers([]);
    } catch (e) {
      console.error("[sessions] cancel session failed", e);
      throw e;
    } finally {
      isCancellingRef.current = false;
    }
  };

  const handleAddGuest = async (sessionId, teamId, guestProfileId) => {
    if (isGuestActingRef.current) return;
    isGuestActingRef.current = true;
    try {
      await clubManagerAddSessionGuest(sessionId, guestProfileId);
      const members = await clubManagerGetTeamMembers(teamId, sessionId);
      setTeamMembers(members ?? []);
    } catch (e) {
      console.error("[sessions] add guest failed", e);
    } finally {
      isGuestActingRef.current = false;
    }
  };

  const handleRemoveGuest = async (sessionId, teamId, guestProfileId) => {
    if (isGuestActingRef.current) return;
    isGuestActingRef.current = true;
    try {
      await clubManagerRemoveSessionGuest(sessionId, guestProfileId);
      const members = await clubManagerGetTeamMembers(teamId, sessionId);
      setTeamMembers(members ?? []);
    } catch (e) {
      console.error("[sessions] remove guest failed", e);
    } finally {
      isGuestActingRef.current = false;
    }
  };

  const handleSetAttendance = (sessionId, profileId, status) => {
    setAttendanceMaps(prev => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] ?? {}), [profileId]: status },
    }));
  };

  const handleMarkAttendance = async (sessionId) => {
    if (isMarkingAttendanceRef.current) return;
    const map = attendanceMaps[sessionId] ?? {};
    const attendances = Object.entries(map).map(([member_profile_id, status]) => ({ member_profile_id, status }));
    if (attendances.length === 0) return;
    isMarkingAttendanceRef.current = true;
    setAttendanceSaving(true);
    try {
      await clubManagerMarkAttendance(sessionId, attendances);
    } catch (e) {
      console.error("[sessions] mark attendance failed", e);
    } finally {
      setAttendanceSaving(false);
      isMarkingAttendanceRef.current = false;
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
  const managedTeamsForClub = (memberProfile.managed_teams ?? []).filter(t => t.club_id === selectedClubId);
  const isManagerOfSession = (session) => !!session?.team_id && managedTeamsForClub.some(t => t.team_id === session.team_id);

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
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                background: "var(--amber)", color: "rgba(0,0,0,0.9)",
                padding: "4px 10px", borderRadius: 20,
                fontFamily: "var(--font-body)",
              }}>
                Manager
              </span>
              <button
                onClick={() => setShowCreateModal(true)}
                style={{
                  fontSize: 13, fontWeight: 700,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid var(--border)",
                  color: "var(--t1)",
                  padding: "5px 12px", borderRadius: 20,
                  fontFamily: "var(--font-body)", cursor: "pointer",
                }}
              >
                + Create
              </button>
            </div>
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
          onClose={() => { setDetailSession(null); setRsvpBoard(null); setTeamMembers([]); }}
          memberProfileId={memberProfile.id}
          isManagerOfSession={isManagerOfSession(detailSession)}
          teamMembers={teamMembers}
          teamMembersLoading={teamMembersLoading}
          onCancelSession={handleCancelSession}
          onAddGuest={handleAddGuest}
          onRemoveGuest={handleRemoveGuest}
          attendanceMap={attendanceMaps[detailSession.session_id] ?? {}}
          onSetAttendance={handleSetAttendance}
          onMarkAttendance={handleMarkAttendance}
          attendanceSaving={attendanceSaving}
        />
      )}

      {/* ── Create session modal ────────────────────────────────────────── */}
      {showCreateModal && (
        <CreateSessionModal
          managedTeams={managedTeamsForClub}
          loading={createLoading}
          onCreateSession={handleCreateSession}
          onCreateSeries={handleCreateSeries}
          onClose={() => setShowCreateModal(false)}
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
function SessionDetail({
  session, board, boardLoading, children, rsvpFor, onRsvpForChange,
  rsvpSaving, onRsvp, onClose, memberProfileId,
  isManagerOfSession, teamMembers, teamMembersLoading, onCancelSession, onAddGuest, onRemoveGuest,
  attendanceMap, onSetAttendance, onMarkAttendance, attendanceSaving,
}) {
  const typeStyle = TYPE_STYLE[session.session_type] ?? TYPE_STYLE.other;

  const [cancelOpen, setCancelOpen]       = useState(false);
  const [cancelReason, setCancelReason]   = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showGuestPicker, setShowGuestPicker] = useState(false);

  const isFuture = session.scheduled_at && new Date(session.scheduled_at) > new Date();
  const canCancel = isManagerOfSession && session.status === "scheduled" && isFuture;

  const guests    = teamMembers.filter(m => m.is_session_guest);
  const nonGuests = teamMembers.filter(m => !m.is_session_guest);

  const handleConfirmCancel = async () => {
    setCancelLoading(true);
    try {
      await onCancelSession(session.session_id, cancelReason);
    } catch {
      setCancelLoading(false);
    }
  };

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

          {/* ── Manager: Guests section ──────────────────────────────── */}
          {isManagerOfSession && (
            <div style={{ marginTop: 20, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--t2)", fontFamily: "var(--font-body)" }}>
                  Guests
                </div>
                {!teamMembersLoading && nonGuests.length > 0 && !showGuestPicker && (
                  <button
                    onClick={() => setShowGuestPicker(true)}
                    style={{
                      fontSize: 12, fontWeight: 700, color: "var(--amber)",
                      background: "none", border: "none", cursor: "pointer",
                      fontFamily: "var(--font-body)", padding: 0,
                    }}
                  >
                    + Add guest
                  </button>
                )}
              </div>

              {teamMembersLoading && (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>Loading…</p>
              )}

              {!teamMembersLoading && guests.length === 0 && !showGuestPicker && (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>No guests added.</p>
              )}

              {!teamMembersLoading && guests.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {guests.map(g => (
                    <div key={g.profile_id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 14, fontFamily: "var(--font-body)" }}>
                        {[g.first_name, g.last_name].filter(Boolean).join(" ")}
                      </span>
                      <button
                        onClick={() => onRemoveGuest(session.session_id, session.team_id, g.profile_id)}
                        style={{
                          fontSize: 12, color: "#FF6060", background: "none",
                          border: "none", cursor: "pointer", fontFamily: "var(--font-body)",
                          fontWeight: 600, padding: 0,
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Guest picker */}
              {showGuestPicker && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 8, fontFamily: "var(--font-body)" }}>
                    Pick a team member to add as guest:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {nonGuests.map(m => (
                      <button
                        key={m.profile_id}
                        onClick={() => {
                          onAddGuest(session.session_id, session.team_id, m.profile_id);
                          setShowGuestPicker(false);
                        }}
                        style={{
                          padding: "6px 14px", borderRadius: 20,
                          border: "1px solid var(--border)",
                          background: "transparent", color: "var(--t1)",
                          fontSize: 13, fontFamily: "var(--font-body)", cursor: "pointer",
                        }}
                      >
                        {[m.first_name, m.last_name].filter(Boolean).join(" ")}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowGuestPicker(false)}
                    style={{
                      marginTop: 8, fontSize: 12, color: "var(--t2)",
                      background: "none", border: "none", cursor: "pointer",
                      fontFamily: "var(--font-body)", padding: 0,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Manager: Attendance section ──────────────────────── */}
          {isManagerOfSession && !isFuture && (
            <div style={{ marginTop: 20, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--t2)", marginBottom: 10, fontFamily: "var(--font-body)" }}>
                Attendance
              </div>

              {teamMembersLoading && (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>Loading…</p>
              )}

              {!teamMembersLoading && teamMembers.length === 0 && (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>No team members.</p>
              )}

              {!teamMembersLoading && teamMembers.length > 0 && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {teamMembers.map(m => {
                      const current = attendanceMap[m.profile_id];
                      return (
                        <div key={m.profile_id} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 12px",
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          gap: 10,
                        }}>
                          <span style={{ fontSize: 14, fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[m.first_name, m.last_name].filter(Boolean).join(" ")}
                          </span>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            {[
                              { key: "attended", label: "✓", color: "rgba(76,175,80,1)", bg: "rgba(76,175,80,0.15)" },
                              { key: "late",     label: "~", color: "var(--amber)",       bg: "rgba(255,190,60,0.15)" },
                              { key: "absent",   label: "✕", color: "#FF6060",            bg: "rgba(255,96,96,0.15)" },
                            ].map(opt => {
                              const active = current === opt.key;
                              return (
                                <button
                                  key={opt.key}
                                  onClick={() => onSetAttendance(session.session_id, m.profile_id, opt.key)}
                                  style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    border: `1px solid ${active ? opt.color : "var(--border)"}`,
                                    background: active ? opt.bg : "transparent",
                                    color: active ? opt.color : "var(--t2)",
                                    fontSize: 14, fontWeight: 700,
                                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                                  }}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => onMarkAttendance(session.session_id)}
                    disabled={attendanceSaving || Object.keys(attendanceMap).length === 0}
                    style={{
                      width: "100%", padding: "11px 0",
                      borderRadius: "var(--r-button)",
                      border: "none",
                      background: "var(--amber)", color: "rgba(0,0,0,0.9)",
                      fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)",
                      cursor: (attendanceSaving || Object.keys(attendanceMap).length === 0) ? "not-allowed" : "pointer",
                      opacity: (attendanceSaving || Object.keys(attendanceMap).length === 0) ? 0.5 : 1,
                    }}
                  >
                    {attendanceSaving ? "Saving…" : "Save attendance"}
                  </button>
                </>
              )}
            </div>
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

          {/* ── Manager: Cancel session ──────────────────────────────── */}
          {canCancel && (
            <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
              {!cancelOpen ? (
                <button
                  onClick={() => setCancelOpen(true)}
                  style={{
                    width: "100%", padding: "11px 0",
                    borderRadius: "var(--r-button)",
                    border: "1px solid rgba(255,96,96,0.4)",
                    background: "rgba(255,96,96,0.08)",
                    color: "#FF6060",
                    fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)",
                    cursor: "pointer",
                  }}
                >
                  Cancel this session
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, fontFamily: "var(--font-body)" }}>
                    Reason (optional)
                  </div>
                  <textarea
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="e.g. Pitch unavailable"
                    rows={2}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "var(--b2)", border: "1px solid var(--border)",
                      borderRadius: 8, color: "var(--t1)",
                      fontSize: 14, fontFamily: "var(--font-body)",
                      padding: "10px 12px", resize: "none",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => { setCancelOpen(false); setCancelReason(""); }}
                      disabled={cancelLoading}
                      style={{
                        flex: 1, padding: "10px 0",
                        borderRadius: "var(--r-button)",
                        border: "1px solid var(--border)",
                        background: "transparent", color: "var(--t2)",
                        fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)",
                        cursor: cancelLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      Keep session
                    </button>
                    <button
                      onClick={handleConfirmCancel}
                      disabled={cancelLoading}
                      style={{
                        flex: 1, padding: "10px 0",
                        borderRadius: "var(--r-button)",
                        border: "none",
                        background: "#FF6060", color: "#fff",
                        fontSize: 14, fontWeight: 700, fontFamily: "var(--font-body)",
                        cursor: cancelLoading ? "not-allowed" : "pointer",
                        opacity: cancelLoading ? 0.6 : 1,
                      }}
                    >
                      {cancelLoading ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CreateSessionModal ────────────────────────────────────────────────────────
function CreateSessionModal({ managedTeams, loading, onCreateSession, onCreateSeries, onClose }) {
  const [mode, setMode]               = useState("oneoff"); // "oneoff" | "recurring"
  const [selectedTeamId, setSelectedTeamId] = useState(managedTeams[0]?.team_id ?? null);
  const [title, setTitle]             = useState("");
  const [sessionType, setSessionType] = useState("training");
  const [scheduledAt, setScheduledAt] = useState("");
  const [dayOfWeek, setDayOfWeek]     = useState(1); // Monday default
  const [startTime, setStartTime]     = useState("18:00");
  const [fromDate, setFromDate]       = useState("");
  const [toDate, setToDate]           = useState("");
  const [location, setLocation]       = useState("");
  const [notes, setNotes]             = useState("");
  const [capacity, setCapacity]       = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [homeAway, setHomeAway]       = useState("home");

  const isMatch = sessionType === "match";

  const handleSubmit = () => {
    if (!selectedTeamId || !title.trim()) return;
    if (mode === "oneoff") {
      if (!scheduledAt) return;
      onCreateSession({
        teamId: selectedTeamId,
        title: title.trim(),
        sessionType,
        scheduledAt,
        location: location.trim() || null,
        notes: notes.trim() || null,
        capacity: capacity ? parseInt(capacity, 10) : null,
        opponentName: isMatch && opponentName.trim() ? opponentName.trim() : null,
        homeAway: isMatch ? homeAway : null,
        meetTime: null,
        opponentVenueName: null,
        opponentAddress: null,
      });
    } else {
      if (!fromDate || !toDate) return;
      onCreateSeries({
        teamId: selectedTeamId,
        title: title.trim(),
        sessionType,
        dayOfWeek,
        startTime,
        fromDate,
        toDate,
        location: location.trim() || null,
        notes: notes.trim() || null,
        capacity: capacity ? parseInt(capacity, 10) : null,
      });
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxHeight: "92vh",
        background: "var(--b1)", borderRadius: "var(--r) var(--r) 0 0",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* Modal header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Create session</div>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 22, color: "var(--t2)",
            cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}>×</button>
        </div>

        {/* Form body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Team selector — only when managing multiple teams */}
          {managedTeams.length > 1 && (
            <div>
              <Label>Team</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {managedTeams.map(t => {
                  const active = t.team_id === selectedTeamId;
                  return (
                    <button key={t.team_id} onClick={() => setSelectedTeamId(t.team_id)} style={{
                      padding: "6px 14px", borderRadius: 20, cursor: "pointer",
                      border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                      background: active ? "var(--amber)" : "transparent",
                      color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                      fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                    }}>
                      {t.team_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mode toggle */}
          <div>
            <Label>Type</Label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {["oneoff", "recurring"].map(m => {
                const active = mode === m;
                return (
                  <button key={m} onClick={() => setMode(m)} style={{
                    flex: 1, padding: "9px 0", borderRadius: "var(--r-button)", cursor: "pointer",
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber)" : "transparent",
                    color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                    fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                  }}>
                    {m === "oneoff" ? "One-off" : "Recurring"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Session type chips */}
          <div>
            <Label>Session type</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {["training", "match", "friendly", "other"].map(t => {
                const active = sessionType === t;
                return (
                  <button key={t} onClick={() => setSessionType(t)} style={{
                    padding: "6px 14px", borderRadius: 20, cursor: "pointer",
                    border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                    background: active ? "var(--amber)" : "transparent",
                    color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                    fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                  }}>
                    {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <Label>Title *</Label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={sessionType === "match" ? "e.g. vs City FC" : "e.g. Tuesday training"}
              style={inputStyle}
            />
          </div>

          {/* One-off: date/time */}
          {mode === "oneoff" && (
            <div>
              <Label>Date & time *</Label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}

          {/* Recurring: day + time + from/to */}
          {mode === "recurring" && (
            <>
              <div>
                <Label>Day of week</Label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {DOW_LABELS.map((label, idx) => {
                    const active = dayOfWeek === idx;
                    return (
                      <button key={idx} onClick={() => setDayOfWeek(idx)} style={{
                        padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                        border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                        background: active ? "var(--amber)" : "transparent",
                        color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                        fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                        minWidth: 40, textAlign: "center",
                      }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Start time</Label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Label>From date *</Label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <Label>To date *</Label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </>
          )}

          {/* Match-specific fields */}
          {isMatch && (
            <>
              <div>
                <Label>Opponent</Label>
                <input
                  value={opponentName}
                  onChange={e => setOpponentName(e.target.value)}
                  placeholder="e.g. City FC"
                  style={inputStyle}
                />
              </div>
              <div>
                <Label>Home / Away</Label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {["home", "away", "neutral"].map(v => {
                    const active = homeAway === v;
                    return (
                      <button key={v} onClick={() => setHomeAway(v)} style={{
                        flex: 1, padding: "8px 0", borderRadius: "var(--r-button)", cursor: "pointer",
                        border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                        background: active ? "var(--amber)" : "transparent",
                        color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                        fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                        textTransform: "capitalize",
                      }}>
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Optional fields */}
          <div>
            <Label>Location</Label>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Main pitch"
              style={inputStyle}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes for the team…"
              rows={2}
              style={{ ...inputStyle, resize: "none" }}
            />
          </div>
          <div>
            <Label>Capacity</Label>
            <input
              type="number"
              value={capacity}
              onChange={e => setCapacity(e.target.value)}
              placeholder="Leave blank for unlimited"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 20px",
          borderTop: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim() || !selectedTeamId || (mode === "oneoff" ? !scheduledAt : !fromDate || !toDate)}
            style={{
              width: "100%", padding: "13px 0",
              borderRadius: "var(--r-button)",
              border: "none",
              background: "var(--amber)", color: "rgba(0,0,0,0.9)",
              fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading
              ? "Creating…"
              : mode === "oneoff"
                ? "Create session"
                : "Create recurring block"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "var(--b2)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--t1)",
  fontSize: 14, fontFamily: "var(--font-body)",
  padding: "10px 12px", marginTop: 6,
};

const wrap = {
  minHeight: "100dvh",
  background: "var(--bg)",
  color: "var(--t1)",
  fontFamily: "var(--font-body)",
  display: "flex",
  flexDirection: "column",
};
