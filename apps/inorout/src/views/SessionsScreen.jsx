import React, { useEffect, useRef, useState } from "react";
import {
  memberGetSelf, memberListChildren,
  memberListUpcomingSessions, memberRsvpSession, memberGetSessionRsvpBoard,
  clubManagerCreateSession, clubManagerCreateSessionSeries, clubManagerCancelSession,
  clubManagerGetTeamMembers, clubManagerAddSessionGuest, clubManagerRemoveSessionGuest,
  clubManagerMarkAttendance, clubManagerGetMemberDetail,
  memberListClubAnnouncements,
  memberGetMerchandise, memberPurchaseMerchandise,
  clubAdminListTournaments, clubAdminCreateTournament, clubAdminUpdateTournamentStatus,
  clubAdminGetTournament,
  clubAdminAddCompetition, clubAdminRegisterTeam,
  clubAdminSendTeamInvite, clubAdminApproveTeam, clubAdminRejectTeam,
  clubAdminGenerateSchedule, clubAdminGetSchedule,
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

  // announcements
  const [announcements, setAnnouncements]             = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);

  // shop
  const [shopItems,    setShopItems]    = useState([]);
  const [shopOrdered,  setShopOrdered]  = useState(null);
  const shopSavingRef = useRef(false);

  // medical detail: { [profileId]: detailObj | 'loading' | 'error' }
  const [memberDetails, setMemberDetails] = useState({});
  const isFetchingDetailRef = useRef(false);

  // tournaments (manager only)
  const [activeTab, setActiveTab]                   = useState("sessions");
  const [tournaments, setTournaments]               = useState([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tForm, setTForm] = useState({ name:"", slug:"", eventDate:"", venueId:"" });
  const [tSaving, setTSaving] = useState(false);
  const [tError, setTError]   = useState(null);
  const isTournamentSavingRef = useRef(false);

  // tournament detail: expanded view per tournament
  const [expandedTournamentId, setExpandedTournamentId] = useState(null);
  const [tournamentDetail, setTournamentDetail]         = useState(null);  // full detail from club_admin_get_tournament
  const [detailLoading, setDetailLoading]               = useState(false);

  // add competition modal
  const [showAddComp, setShowAddComp]         = useState(false);
  const [compForm, setCompForm]               = useState({ name:"", type:"cup", format:"" });
  const [compSaving, setCompSaving]           = useState(false);
  const [compError, setCompError]             = useState(null);
  const isCompSavingRef = useRef(false);

  // register team modal
  const [registerCompId, setRegisterCompId]   = useState(null);
  const [registerTeamName, setRegisterTeamName] = useState("");
  const [registerSaving, setRegisterSaving]   = useState(false);
  const [registerError, setRegisterError]     = useState(null);
  const isRegisteringRef = useRef(false);

  // invite modal
  const [inviteCompId, setInviteCompId]       = useState(null);
  const [inviteCode, setInviteCode]           = useState(null);
  const [inviteSaving, setInviteSaving]       = useState(false);
  const isInvitingRef = useRef(false);

  // approve/reject
  const isActingOnTeamRef = useRef(false);

  // schedule data (from club_admin_get_schedule)
  const [scheduleData, setScheduleData]       = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // generate schedule modal
  const [showGenModal, setShowGenModal]   = useState(false);
  const [genCompId, setGenCompId]         = useState(null);
  const [genForm, setGenForm]             = useState({ slotMinutes: 45, startTime: "09:00", startDate: "" });
  const [genPitchIds, setGenPitchIds]     = useState([]);
  const [genSaving, setGenSaving]         = useState(false);
  const [genError, setGenError]           = useState(null);
  const isGeneratingRef                   = useRef(false);

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

  // Load announcements + shop items when a club is selected
  useEffect(() => {
    if (!selectedClubId) return;
    let alive = true;
    setAnnouncementsLoading(true);
    setAnnouncements([]);
    setShowAllAnnouncements(false);
    setShopItems([]);
    setShopOrdered(null);
    memberListClubAnnouncements(selectedClubId)
      .then(data => { if (alive) setAnnouncements(data ?? []); })
      .catch(e => { console.error("[sessions] announcements failed", e); })
      .finally(() => { if (alive) setAnnouncementsLoading(false); });
    memberGetMerchandise(selectedClubId)
      .then(data => { if (alive) setShopItems(data ?? []); })
      .catch(e => { console.error("[sessions] shop failed", e); });
    return () => { alive = false; };
  }, [selectedClubId]);

  // Load tournaments when manager switches to the tournaments tab
  useEffect(() => {
    if (!selectedClubId || activeTab !== "tournaments") return;
    let alive = true;
    setTournamentsLoading(true);
    setTournaments([]);
    clubAdminListTournaments(selectedClubId)
      .then(data => { if (alive) setTournaments(data ?? []); })
      .catch(e => { console.error("[sessions] tournaments failed", e); })
      .finally(() => { if (alive) setTournamentsLoading(false); });
    return () => { alive = false; };
  }, [selectedClubId, activeTab]);

  const handleCreateTournament = async () => {
    if (isTournamentSavingRef.current) return;
    isTournamentSavingRef.current = true;
    setTSaving(true);
    setTError(null);
    try {
      await clubAdminCreateTournament(
        selectedClubId,
        tForm.venueId.trim(),
        tForm.name.trim(),
        tForm.slug.trim(),
        tForm.eventDate,
      );
      setShowCreateTournament(false);
      setTForm({ name:"", slug:"", eventDate:"", venueId:"" });
      const refreshed = await clubAdminListTournaments(selectedClubId);
      setTournaments(refreshed ?? []);
    } catch (e) {
      console.error("[sessions] create tournament failed", e);
      setTError(e?.message ?? "Failed to create tournament");
    } finally {
      setTSaving(false);
      isTournamentSavingRef.current = false;
    }
  };

  const loadTournamentDetail = async (t) => {
    if (expandedTournamentId === t.tournament_id) {
      setExpandedTournamentId(null);
      setTournamentDetail(null);
      setScheduleData(null);
      return;
    }
    setExpandedTournamentId(t.tournament_id);
    setTournamentDetail(null);
    setScheduleData(null);
    setDetailLoading(true);
    setScheduleLoading(true);
    try {
      const [detail, schedule] = await Promise.all([
        clubAdminGetTournament(t.slug),
        clubAdminGetSchedule(t.tournament_id),
      ]);
      setTournamentDetail(detail);
      setScheduleData(schedule);
    } catch (e) {
      console.error("[sessions] tournament detail failed", e);
    } finally {
      setDetailLoading(false);
      setScheduleLoading(false);
    }
  };

  const reloadDetail = async (slug, tournamentId) => {
    try {
      const [detail, schedule] = await Promise.all([
        clubAdminGetTournament(slug),
        clubAdminGetSchedule(tournamentId),
      ]);
      setTournamentDetail(detail);
      setScheduleData(schedule);
    } catch (e) {
      console.error("[sessions] reload detail failed", e);
    }
  };

  const handleAddCompetition = async () => {
    if (isCompSavingRef.current || !tournamentDetail) return;
    const name = compForm.name.trim();
    if (!name) { setCompError("Competition name required."); return; }
    isCompSavingRef.current = true;
    setCompSaving(true);
    setCompError(null);
    try {
      await clubAdminAddCompetition(
        tournamentDetail.tournament_id,
        name,
        compForm.type,
        compForm.format.trim() || null,
      );
      setShowAddComp(false);
      setCompForm({ name:"", type:"cup", format:"" });
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] add competition failed", e);
      setCompError(e?.message ?? "Failed to add competition.");
    } finally {
      setCompSaving(false);
      isCompSavingRef.current = false;
    }
  };

  const handleRegisterTeam = async () => {
    if (isRegisteringRef.current || !tournamentDetail || !registerCompId) return;
    const name = registerTeamName.trim();
    if (!name) { setRegisterError("Enter a team name."); return; }
    isRegisteringRef.current = true;
    setRegisterSaving(true);
    setRegisterError(null);
    try {
      await clubAdminRegisterTeam(tournamentDetail.tournament_id, registerCompId, name);
      setRegisterCompId(null);
      setRegisterTeamName("");
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] register team failed", e);
      setRegisterError(e?.message ?? "Failed to register team.");
    } finally {
      setRegisterSaving(false);
      isRegisteringRef.current = false;
    }
  };

  const handleSendInvite = async (competitionId) => {
    if (isInvitingRef.current || !tournamentDetail) return;
    isInvitingRef.current = true;
    setInviteSaving(true);
    setInviteCode(null);
    setInviteCompId(competitionId);
    try {
      const result = await clubAdminSendTeamInvite(tournamentDetail.tournament_id, competitionId);
      if (result?.ok) setInviteCode(result.code);
    } catch (e) {
      console.error("[sessions] send invite failed", e);
    } finally {
      setInviteSaving(false);
      isInvitingRef.current = false;
    }
  };

  const handleApproveTeam = async (competitionTeamId) => {
    if (isActingOnTeamRef.current || !tournamentDetail) return;
    isActingOnTeamRef.current = true;
    try {
      await clubAdminApproveTeam(competitionTeamId);
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] approve team failed", e);
    } finally {
      isActingOnTeamRef.current = false;
    }
  };

  const handleRejectTeam = async (competitionTeamId) => {
    if (isActingOnTeamRef.current || !tournamentDetail) return;
    isActingOnTeamRef.current = true;
    try {
      await clubAdminRejectTeam(competitionTeamId);
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] reject team failed", e);
    } finally {
      isActingOnTeamRef.current = false;
    }
  };

  const handleGenerateSchedule = async () => {
    if (isGeneratingRef.current || !tournamentDetail || !genCompId) return;
    if (!genForm.startDate) { setGenError("Start date required."); return; }
    isGeneratingRef.current = true;
    setGenSaving(true);
    setGenError(null);
    try {
      await clubAdminGenerateSchedule(
        tournamentDetail.tournament_id,
        genCompId,
        Number(genForm.slotMinutes),
        genForm.startTime,
        genForm.startDate,
        genPitchIds,
      );
      setShowGenModal(false);
      setGenCompId(null);
      setGenForm({ slotMinutes: 45, startTime: "09:00", startDate: "" });
      setGenPitchIds([]);
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] generate schedule failed", e);
      setGenError(e?.message ?? "Failed to generate schedule.");
    } finally {
      setGenSaving(false);
      isGeneratingRef.current = false;
    }
  };

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

  const handleFetchMemberDetail = async (profileId) => {
    if (memberDetails[profileId]) return;
    setMemberDetails(prev => ({ ...prev, [profileId]: "loading" }));
    try {
      const detail = await clubManagerGetMemberDetail(profileId);
      setMemberDetails(prev => ({ ...prev, [profileId]: detail }));
    } catch (e) {
      console.error("[sessions] get member detail failed", e);
      setMemberDetails(prev => ({ ...prev, [profileId]: "error" }));
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
              {activeTab === "sessions" && (
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
              )}
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

        {/* Manager tab bar */}
        {isManager && selectedClubId && (
          <div style={{ display: "flex", gap: 4, marginTop: 14 }}>
            {["sessions", "tournaments"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "6px 16px", borderRadius: 20,
                  border: `1px solid ${activeTab === tab ? "var(--amber)" : "var(--border)"}`,
                  background: activeTab === tab ? "var(--amber)" : "transparent",
                  color: activeTab === tab ? "rgba(0,0,0,0.9)" : "var(--t2)",
                  fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                  fontFamily: "var(--font-body)", cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Announcements ───────────────────────────────────────────────── */}
      {selectedClubId && activeTab === "sessions" && (announcementsLoading || announcements.length > 0) && (
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{
            background: "var(--b2)", border: "1px solid var(--border-subtle)",
            borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 14px",
              borderBottom: announcements.length > 0 ? "1px solid var(--border-subtle)" : "none",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                Announcements
              </span>
              {announcements.length > 3 && (
                <button onClick={() => setShowAllAnnouncements(v => !v)}
                  style={{ fontSize: 12, color: "var(--t2)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)" }}>
                  {showAllAnnouncements ? "Show less" : `See all (${announcements.length})`}
                </button>
              )}
            </div>
            {announcementsLoading && (
              <p style={{ padding: "10px 14px", fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading…</p>
            )}
            {!announcementsLoading && (showAllAnnouncements ? announcements : announcements.slice(0, 3)).map((a, i) => (
              <div key={a.id} style={{
                padding: "10px 14px",
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)", fontFamily: "var(--font-body)", marginBottom: 4 }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                  {a.body}
                </div>
                <div style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", marginTop: 6 }}>
                  {fmtDate(a.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Shop ────────────────────────────────────────────────────────── */}
      {selectedClubId && activeTab === "sessions" && shopItems.length > 0 && (
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{
            background: "var(--b2)", border: "1px solid var(--border-subtle)",
            borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                Club Shop
              </span>
            </div>
            {shopOrdered && (
              <div style={{ padding: "10px 14px", background: "rgba(76,175,80,0.08)", borderBottom: "1px solid var(--border-subtle)" }}>
                <p style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", margin: 0 }}>
                  ✓ Order placed — the club will arrange payment and delivery.
                </p>
              </div>
            )}
            {shopItems.map((item, i) => (
              <ShopItemRow
                key={item.id}
                item={item}
                isFirst={i === 0}
                onOrder={async (qty) => {
                  if (shopSavingRef.current) return;
                  shopSavingRef.current = true;
                  try {
                    await memberPurchaseMerchandise(item.id, qty);
                    setShopOrdered(item.id);
                  } catch (e) {
                    console.error("[shop] purchase failed", e);
                  } finally {
                    shopSavingRef.current = false;
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Session list ────────────────────────────────────────────────── */}
      {activeTab === "sessions" && <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

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
      </div>}

      {/* ── Tournaments view ────────────────────────────────────────────── */}
      {activeTab === "tournaments" && selectedClubId && (
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
              Tournaments
            </span>
            <button
              onClick={() => {
                const venues = memberProfile?.active_clubs?.find(c => c.club_id === selectedClubId)?.venues ?? [];
                setTError(null);
                setTForm({ name:"", slug:"", eventDate:"", venueId: venues.length === 1 ? venues[0].venue_id : "" });
                setShowCreateTournament(true);
              }}
              style={{
                fontSize: 13, fontWeight: 700,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid var(--border)",
                color: "var(--t1)",
                padding: "5px 12px", borderRadius: 20,
                fontFamily: "var(--font-body)", cursor: "pointer",
              }}
            >
              + New Tournament
            </button>
          </div>

          {tournamentsLoading && (
            <p style={{ color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)", textAlign: "center", marginTop: 24 }}>
              Loading…
            </p>
          )}

          {!tournamentsLoading && tournaments.length === 0 && (
            <p style={{ color: "var(--t2)", fontSize: 14, fontFamily: "var(--font-body)", textAlign: "center", marginTop: 24 }}>
              No tournaments yet. Create one to get started.
            </p>
          )}

          {tournaments.map(t => {
            const isExpanded = expandedTournamentId === t.tournament_id;
            return (
              <div key={t.tournament_id} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div
                  style={{
                    background: "var(--b2)", border: "1px solid var(--border-subtle)",
                    borderRadius: isExpanded ? "var(--r) var(--r) 0 0" : "var(--r)",
                    padding: "14px 16px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button
                      onClick={() => loadTournamentDetail(t)}
                      style={{
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 15, color: "var(--t1)",
                        textAlign: "left", flex: 1,
                      }}
                    >
                      {isExpanded ? "▾ " : "▸ "}{t.name}
                    </button>
                    <select
                      value={t.status}
                      onChange={async e => {
                        const next = e.target.value;
                        setTournaments(ts => ts.map(x => x.tournament_id === t.tournament_id ? { ...x, status: next } : x));
                        try {
                          await clubAdminUpdateTournamentStatus(t.slug, next);
                        } catch (err) {
                          console.error("[sessions] status update failed", err);
                          setTournaments(ts => ts.map(x => x.tournament_id === t.tournament_id ? { ...x, status: t.status } : x));
                        }
                      }}
                      style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                        padding: "3px 8px", borderRadius: 20,
                        fontFamily: "var(--font-body)", textTransform: "uppercase",
                        background: t.status === "live" ? "rgba(76,175,80,0.15)" : t.status === "open" ? "rgba(255,190,60,0.12)" : "rgba(255,255,255,0.06)",
                        color: t.status === "live" ? "rgba(76,175,80,1)" : t.status === "open" ? "var(--amber)" : "var(--t2)",
                        border: "1px solid transparent", outline: "none", cursor: "pointer", appearance: "none",
                      }}
                    >
                      {["draft", "open", "closed", "live", "completed"].map(s => (
                        <option key={s} value={s} style={{ background: "var(--bg)", color: "var(--t1)", textTransform: "none" }}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>
                    {fmtDate(t.event_date)}{t.event_end_date ? ` – ${fmtDate(t.event_end_date)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flex: 1 }}>
                      /tournament/{t.slug}
                    </span>
                    <a
                      href={`/tournament/${t.slug}`}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)" }}
                    >
                      Public page ↗
                    </a>
                  </div>
                </div>

                {/* ── Expanded detail panel ── */}
                {isExpanded && (
                  <div style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--border-subtle)", borderTop: "none",
                    borderRadius: "0 0 var(--r) var(--r)",
                    padding: "14px 16px",
                    display: "flex", flexDirection: "column", gap: 14,
                  }}>
                    {detailLoading && (
                      <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>Loading…</p>
                    )}
                    {!detailLoading && tournamentDetail && (
                      <>
                        {/* Competitions */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                            Competitions
                          </span>
                          <button
                            onClick={() => { setShowAddComp(true); setCompError(null); setCompForm({ name:"", type:"cup", format:"" }); }}
                            style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--t1)", padding: "3px 10px", borderRadius: 16, fontFamily: "var(--font-body)", cursor: "pointer" }}
                          >
                            + Add
                          </button>
                        </div>

                        {tournamentDetail.competitions.length === 0 && (
                          <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", margin: 0 }}>
                            No competitions yet. Add one to register teams.
                          </p>
                        )}

                        {/* ── Director timetable ── */}
                        {scheduleData && (() => {
                          const allFixtures = (scheduleData.competitions ?? [])
                            .flatMap(c => (c.fixtures ?? []).map(fx => ({ ...fx, comp_name: c.name })));
                          if (allFixtures.length === 0) return null;
                          const sorted = [...allFixtures].sort((a, b) => {
                            const da = (a.scheduled_date || "") + (a.kickoff_time || "");
                            const db = (b.scheduled_date || "") + (b.kickoff_time || "");
                            return da < db ? -1 : da > db ? 1 : 0;
                          });
                          return (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 8 }}>
                                Full Timetable
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                {sorted.map(fx => (
                                  <div key={fx.fixture_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                    {fx.kickoff_time && (
                                      <span style={{ fontSize: 11, color: "var(--amber)", fontFamily: "var(--font-body)", flexShrink: 0, width: 36 }}>{fx.kickoff_time.slice(0,5)}</span>
                                    )}
                                    <span style={{ fontSize: 12, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {fx.home_score != null ? `${fx.home_score}–${fx.away_score} ` : ""}{fx.home_team_name} vs {fx.away_team_name}
                                    </span>
                                    <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0 }}>{fx.comp_name}</span>
                                    {fx.pitch_name && (
                                      <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0 }}>· {fx.pitch_name}</span>
                                    )}
                                    {fx.ref_token && (
                                      <button
                                        onClick={() => navigator.clipboard.writeText(`https://platform-ref.vercel.app/?token=${fx.ref_token}`)}
                                        style={{ fontSize: 10, fontWeight: 700, background: "rgba(96,160,255,0.1)", border: "1px solid rgba(96,160,255,0.25)", color: "#60A0FF", padding: "2px 7px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}
                                      >
                                        Ref
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {tournamentDetail.competitions.map(comp => {
                          const activeTeams  = comp.teams.filter(tm => tm.status === "active");
                          const pendingTeams = comp.teams.filter(tm => tm.status === "pending");
                          const compSchedule = scheduleData?.competitions?.find(c => c.competition_id === comp.competition_id);
                          const fixtures     = compSchedule?.fixtures ?? [];
                          const pitches      = scheduleData?.venue_playing_areas ?? [];
                          // Group fixtures by round for display
                          const fixturesByRound = fixtures.reduce((acc, fx) => {
                            const k = fx.round_name || `Round ${fx.round}`;
                            if (!acc[k]) acc[k] = [];
                            acc[k].push(fx);
                            return acc;
                          }, {});
                          return (
                            <div key={comp.competition_id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)" }}>
                                  {comp.name}
                                  <span style={{ fontSize: 11, fontWeight: 400, color: "var(--t3, #666)", marginLeft: 6 }}>
                                    {comp.type}{comp.format ? ` · ${comp.format}` : ""}
                                  </span>
                                </span>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    onClick={() => { setRegisterCompId(comp.competition_id); setRegisterTeamName(""); setRegisterError(null); }}
                                    style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--t2)", padding: "3px 8px", borderRadius: 14, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                  >
                                    Register team
                                  </button>
                                  <button
                                    onClick={() => handleSendInvite(comp.competition_id)}
                                    disabled={inviteSaving && inviteCompId === comp.competition_id}
                                    style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,190,60,0.08)", border: "1px solid rgba(255,190,60,0.2)", color: "var(--amber)", padding: "3px 8px", borderRadius: 14, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                  >
                                    {inviteSaving && inviteCompId === comp.competition_id ? "…" : "Get invite link"}
                                  </button>
                                </div>
                              </div>

                              {/* Invite code display */}
                              {inviteCode && inviteCompId === comp.competition_id && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(255,190,60,0.06)", border: "1px solid rgba(255,190,60,0.15)", borderRadius: 8, padding: "8px 12px" }}>
                                  <span style={{ fontSize: 12, fontFamily: "var(--font-body)", color: "var(--t1)", flex: 1, wordBreak: "break-all" }}>
                                    {window.location.origin}/tournament/join/{inviteCode}
                                  </span>
                                  <button
                                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/tournament/join/${inviteCode}`)}
                                    style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,190,60,0.15)", border: "1px solid rgba(255,190,60,0.3)", color: "var(--amber)", padding: "4px 10px", borderRadius: 12, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}
                                  >
                                    Copy
                                  </button>
                                </div>
                              )}

                              {/* Register team form */}
                              {registerCompId === comp.competition_id && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {registerError && (
                                    <div style={{ fontSize: 12, color: "#FF6060", fontFamily: "var(--font-body)" }}>{registerError}</div>
                                  )}
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <input
                                      type="text"
                                      value={registerTeamName}
                                      onChange={e => setRegisterTeamName(e.target.value)}
                                      placeholder="Team name"
                                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 1 }}
                                    />
                                    <button
                                      onClick={handleRegisterTeam}
                                      disabled={registerSaving}
                                      style={{ fontSize: 12, fontWeight: 700, background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)", color: "rgba(76,175,80,1)", padding: "8px 14px", borderRadius: 8, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                    >
                                      {registerSaving ? "…" : "Add"}
                                    </button>
                                    <button
                                      onClick={() => setRegisterCompId(null)}
                                      style={{ fontSize: 12, background: "none", border: "1px solid var(--border)", color: "var(--t2)", padding: "8px 10px", borderRadius: 8, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Pending approvals */}
                              {pendingTeams.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--amber)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                                    Pending approval
                                  </span>
                                  {pendingTeams.map(tm => (
                                    <div key={tm.competition_team_id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,190,60,0.06)", borderRadius: 8, padding: "8px 12px" }}>
                                      <span style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1 }}>{tm.team_name}</span>
                                      <button onClick={() => handleApproveTeam(tm.competition_team_id)} style={{ fontSize: 11, fontWeight: 700, background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)", color: "rgba(76,175,80,1)", padding: "4px 10px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer" }}>
                                        Approve
                                      </button>
                                      <button onClick={() => handleRejectTeam(tm.competition_team_id)} style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,96,96,0.08)", border: "1px solid rgba(255,96,96,0.2)", color: "#FF6060", padding: "4px 10px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer" }}>
                                        Reject
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Active teams */}
                              {activeTeams.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  {activeTeams.map(tm => (
                                    <div key={tm.competition_team_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                      <span style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1 }}>{tm.team_name}</span>
                                      <span style={{ fontSize: 11, color: "rgba(76,175,80,0.7)", fontFamily: "var(--font-body)" }}>✓</span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {activeTeams.length === 0 && pendingTeams.length === 0 && (
                                <p style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)", margin: 0 }}>
                                  No teams yet.
                                </p>
                              )}

                              {/* ── Schedule section ──────────────────── */}
                              {fixtures.length === 0 && activeTeams.length >= 2 && (
                                <div style={{ marginTop: 8 }}>
                                  <button
                                    onClick={() => { setGenCompId(comp.competition_id); setGenForm({ slotMinutes: 45, startTime: "09:00", startDate: "" }); setGenPitchIds([]); setGenError(null); setShowGenModal(true); }}
                                    style={{ fontSize: 12, fontWeight: 700, background: "rgba(96,160,255,0.12)", border: "1px solid rgba(96,160,255,0.3)", color: "#60A0FF", padding: "6px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                  >
                                    Generate schedule
                                  </button>
                                </div>
                              )}

                              {fixtures.length > 0 && (() => {
                                // Compute standings from completed fixtures
                                const completedFx = fixtures.filter(fx => fx.status === "completed" && fx.home_score != null && fx.away_score != null);
                                const standingsMap = {};
                                activeTeams.forEach(tm => {
                                  standingsMap[tm.competition_team_id] = { name: tm.team_name, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 };
                                });
                                completedFx.forEach(fx => {
                                  const h = standingsMap[fx.home_team_id], a = standingsMap[fx.away_team_id];
                                  if (h) { h.P++; h.GF += fx.home_score; h.GA += fx.away_score; if (fx.home_score > fx.away_score) h.W++; else if (fx.home_score === fx.away_score) h.D++; else h.L++; }
                                  if (a) { a.P++; a.GF += fx.away_score; a.GA += fx.home_score; if (fx.away_score > fx.home_score) a.W++; else if (fx.home_score === fx.away_score) a.D++; else a.L++; }
                                });
                                const standings = Object.values(standingsMap).sort((a, b) => {
                                  const pa = a.W * 3 + a.D, pb = b.W * 3 + b.D;
                                  if (pa !== pb) return pb - pa;
                                  const gda = a.GF - a.GA, gdb = b.GF - b.GA;
                                  if (gda !== gdb) return gdb - gda;
                                  return b.GF - a.GF;
                                });
                                return (
                                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                                    {Object.entries(fixturesByRound).map(([roundName, roundFixtures]) => (
                                      <div key={roundName}>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>{roundName}</div>
                                        {roundFixtures.map(fx => (
                                          <div key={fx.fixture_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                            <span style={{ fontSize: 12, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fx.home_team_name}</span>
                                            <span style={{ fontSize: 10, color: fx.home_score != null ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, fontWeight: fx.home_score != null ? 700 : 400 }}>
                                              {fx.home_score != null ? `${fx.home_score}–${fx.away_score}` : "vs"}
                                            </span>
                                            <span style={{ fontSize: 12, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{fx.away_team_name}</span>
                                            {fx.kickoff_time && (
                                              <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, marginLeft: 4 }}>{fx.kickoff_time.slice(0,5)}</span>
                                            )}
                                            {fx.pitch_name && (
                                              <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, marginLeft: 4 }}>· {fx.pitch_name}</span>
                                            )}
                                            {fx.ref_token && (
                                              <button
                                                onClick={() => navigator.clipboard.writeText(`https://platform-ref.vercel.app/?token=${fx.ref_token}`)}
                                                style={{ fontSize: 10, fontWeight: 700, background: "rgba(96,160,255,0.1)", border: "1px solid rgba(96,160,255,0.25)", color: "#60A0FF", padding: "2px 7px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}
                                              >
                                                Ref
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ))}

                                    {/* Standings table — shown once any fixture is complete */}
                                    {completedFx.length > 0 && (
                                      <div style={{ marginTop: 4 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>Standings</div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(6,28px)", gap: 0, fontSize: 10, fontFamily: "var(--font-body)" }}>
                                          <span style={{ color: "var(--t3, #666)", padding: "2px 0" }}>Team</span>
                                          {["P","W","D","L","GD","Pts"].map(h => (
                                            <span key={h} style={{ color: "var(--t3, #666)", textAlign: "right", padding: "2px 0" }}>{h}</span>
                                          ))}
                                          {standings.map(row => {
                                            const pts = row.W * 3 + row.D;
                                            return [
                                              <span key={row.name + "n"} style={{ color: "var(--t1)", padding: "3px 0", borderTop: "1px solid var(--border-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>,
                                              ...[row.P, row.W, row.D, row.L, row.GF - row.GA, pts].map((v, i) => (
                                                <span key={row.name + i} style={{ color: i === 5 ? "var(--t1)" : "var(--t2)", fontWeight: i === 5 ? 700 : 400, textAlign: "right", padding: "3px 0", borderTop: "1px solid var(--border-subtle)" }}>{v > 0 && i === 4 ? `+${v}` : v}</span>
                                              ))
                                            ];
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add competition modal ───────────────────────────────────────── */}
      {showAddComp && tournamentDetail && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowAddComp(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--b2)", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 540, padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)" }}>Add Competition</div>

            {compError && (
              <div style={{ fontSize: 13, color: "#FF6060", background: "rgba(255,96,96,0.08)", padding: "8px 12px", borderRadius: 8, fontFamily: "var(--font-body)" }}>{compError}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Name</label>
              <input type="text" value={compForm.name} onChange={e => setCompForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. U12 Boys Cup" style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Type</label>
                <select value={compForm.type} onChange={e => setCompForm(f => ({ ...f, type: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", appearance: "none" }}>
                  {["cup", "league", "group_stage", "performance"].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Format (optional)</label>
                <input type="text" value={compForm.format} onChange={e => setCompForm(f => ({ ...f, format: e.target.value }))} placeholder="e.g. 5-a-side" style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
            </div>

            <button onClick={handleAddCompetition} disabled={compSaving || !compForm.name.trim()} style={{ marginTop: 4, background: compSaving ? "rgba(255,255,255,0.1)" : "var(--amber)", color: compSaving ? "var(--t2)" : "rgba(0,0,0,0.9)", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)", cursor: compSaving ? "not-allowed" : "pointer", width: "100%" }}>
              {compSaving ? "Adding…" : "Add Competition"}
            </button>
          </div>
        </div>
      )}

      {/* ── Generate schedule modal ──────────────────────────────────────── */}
      {showGenModal && tournamentDetail && genCompId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowGenModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--b2)", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 540, padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)" }}>Generate Schedule</div>

            {genError && (
              <div style={{ fontSize: 13, color: "#FF6060", background: "rgba(255,96,96,0.08)", padding: "8px 12px", borderRadius: 8, fontFamily: "var(--font-body)" }}>{genError}</div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Start date</label>
                <input type="date" value={genForm.startDate} onChange={e => setGenForm(f => ({ ...f, startDate: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>First kick-off</label>
                <input type="time" value={genForm.startTime} onChange={e => setGenForm(f => ({ ...f, startTime: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 80 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Slot (min)</label>
                <input type="number" min="5" max="120" value={genForm.slotMinutes} onChange={e => setGenForm(f => ({ ...f, slotMinutes: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
            </div>

            {(scheduleData?.venue_playing_areas ?? []).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Pitches (optional)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(scheduleData?.venue_playing_areas ?? []).map(pa => {
                    const selected = genPitchIds.includes(pa.id);
                    return (
                      <button key={pa.id} onClick={() => setGenPitchIds(ids => selected ? ids.filter(x => x !== pa.id) : [...ids, pa.id])}
                        style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", border: selected ? "1px solid rgba(96,160,255,0.6)" : "1px solid var(--border)", background: selected ? "rgba(96,160,255,0.15)" : "rgba(255,255,255,0.04)", color: selected ? "#60A0FF" : "var(--t2)" }}>
                        {pa.name}
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", margin: 0 }}>Select pitches to auto-assign. Leave blank for no pitch assignment.</p>
              </div>
            )}

            <button onClick={handleGenerateSchedule} disabled={genSaving || !genForm.startDate} style={{ marginTop: 4, background: genSaving ? "rgba(255,255,255,0.1)" : "var(--amber)", color: genSaving ? "var(--t2)" : "rgba(0,0,0,0.9)", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)", cursor: genSaving ? "not-allowed" : "pointer", width: "100%" }}>
              {genSaving ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      )}

      {/* ── Create tournament modal ─────────────────────────────────────── */}
      {showCreateTournament && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.7)", display: "flex",
          alignItems: "flex-end", justifyContent: "center",
        }} onClick={() => setShowCreateTournament(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--b2)", borderRadius: "16px 16px 0 0",
              width: "100%", maxWidth: 540, padding: "24px 20px 40px",
              display: "flex", flexDirection: "column", gap: 16,
            }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>New Tournament</div>

            {tError && (
              <div style={{ fontSize: 13, color: "#FF6060", fontFamily: "var(--font-body)", background: "rgba(255,96,96,0.08)", padding: "8px 12px", borderRadius: 8 }}>
                {tError}
              </div>
            )}

            {[
              { label: "Name", key: "name", placeholder: "e.g. FC United Summer Cup 2026", type: "text" },
              { label: "Slug", key: "slug", placeholder: "e.g. fc-united-summer-2026", type: "text" },
              { label: "Event date", key: "eventDate", placeholder: "", type: "date" },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                  {label}
                </label>
                <input
                  type={type}
                  value={tForm[key]}
                  onChange={e => {
                    const v = e.target.value;
                    if (key === "name") {
                      const auto = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                      setTForm(f => ({ ...f, name: v, slug: f.slug || auto }));
                    } else {
                      setTForm(f => ({ ...f, [key]: v }));
                    }
                  }}
                  placeholder={placeholder}
                  style={{
                    background: "var(--b3, rgba(255,255,255,0.06))",
                    border: "1px solid var(--border)",
                    borderRadius: 8, padding: "10px 12px",
                    fontSize: 14, color: "var(--t1)",
                    fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            {(() => {
              const venues = memberProfile?.active_clubs?.find(c => c.club_id === selectedClubId)?.venues ?? [];
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                    Venue
                  </label>
                  <select
                    value={tForm.venueId}
                    onChange={e => setTForm(f => ({ ...f, venueId: e.target.value }))}
                    style={{
                      background: "var(--b3, rgba(255,255,255,0.06))",
                      border: "1px solid var(--border)",
                      borderRadius: 8, padding: "10px 12px",
                      fontSize: 14, color: tForm.venueId ? "var(--t1)" : "var(--t3, #666)",
                      fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box",
                      appearance: "none",
                    }}
                  >
                    {venues.length !== 1 && (
                      <option value="" disabled>Select a venue…</option>
                    )}
                    {venues.map(v => (
                      <option key={v.venue_id} value={v.venue_id}>{v.venue_name}</option>
                    ))}
                  </select>
                </div>
              );
            })()}

            <button
              onClick={handleCreateTournament}
              disabled={tSaving || !tForm.name || !tForm.slug || !tForm.eventDate || !tForm.venueId}
              style={{
                marginTop: 4,
                background: tSaving ? "rgba(255,255,255,0.1)" : "var(--amber)",
                color: tSaving ? "var(--t2)" : "rgba(0,0,0,0.9)",
                border: "none", borderRadius: 10, padding: "14px",
                fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)",
                cursor: tSaving ? "not-allowed" : "pointer", width: "100%",
              }}
            >
              {tSaving ? "Creating…" : "Create Tournament"}
            </button>
          </div>
        </div>
      )}

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
          memberDetails={memberDetails}
          onFetchMemberDetail={handleFetchMemberDetail}
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
  memberDetails, onFetchMemberDetail,
}) {
  const typeStyle = TYPE_STYLE[session.session_type] ?? TYPE_STYLE.other;

  const [cancelOpen, setCancelOpen]       = useState(false);
  const [cancelReason, setCancelReason]   = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showGuestPicker, setShowGuestPicker] = useState(false);
  const [expandedMedical, setExpandedMedical] = useState(null); // profileId of expanded card

  const isFuture = session.scheduled_at && new Date(session.scheduled_at) > new Date();
  const msUntil  = session.scheduled_at ? new Date(session.scheduled_at) - new Date() : Infinity;
  const within48h = msUntil > 0 && msUntil < 48 * 3600 * 1000;
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

          {/* ── Manager: Medical alerts (within 48h of future session) ── */}
          {isManagerOfSession && within48h && teamMembers.length > 0 && (
            <div style={{ marginTop: 20, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--t2)", marginBottom: 10, fontFamily: "var(--font-body)" }}>
                Medical alerts
              </div>
              {teamMembers.filter(m => m.has_medical_notes).length === 0 ? (
                <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)" }}>No medical notes on record for this squad.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {teamMembers.filter(m => m.has_medical_notes).map(m => {
                    const detail = memberDetails[m.profile_id];
                    const isExpanded = expandedMedical === m.profile_id;
                    return (
                      <div key={m.profile_id} style={{
                        background: "rgba(255,190,60,0.08)",
                        border: "1px solid rgba(255,190,60,0.3)",
                        borderRadius: 10, overflow: "hidden",
                      }}>
                        <div
                          onClick={() => {
                            if (!isExpanded) onFetchMemberDetail(m.profile_id);
                            setExpandedMedical(isExpanded ? null : m.profile_id);
                          }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 14px", cursor: "pointer",
                          }}
                        >
                          <span style={{ fontSize: 14, fontFamily: "var(--font-body)", fontWeight: 600 }}>
                            ⚠ {[m.first_name, m.last_name].filter(Boolean).join(" ")}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--amber)", fontFamily: "var(--font-body)" }}>
                            {isExpanded ? "Hide" : "View"}
                          </span>
                        </div>
                        {isExpanded && (
                          <div style={{ padding: "0 14px 12px", borderTop: "1px solid rgba(255,190,60,0.15)" }}>
                            {detail === "loading" && (
                              <p style={{ color: "var(--t2)", fontSize: 13, fontFamily: "var(--font-body)", marginTop: 10 }}>Loading…</p>
                            )}
                            {detail === "error" && (
                              <p style={{ color: "#FF6060", fontSize: 13, fontFamily: "var(--font-body)", marginTop: 10 }}>Could not load details.</p>
                            )}
                            {detail && detail !== "loading" && detail !== "error" && (
                              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                                {detail.medical_conditions && <MedRow label="Conditions" value={detail.medical_conditions} />}
                                {detail.allergies          && <MedRow label="Allergies"  value={detail.allergies} />}
                                {detail.medications        && <MedRow label="Medication" value={detail.medications} />}
                                {detail.gp_details         && <MedRow label="GP"         value={detail.gp_details} />}
                                {detail.send_notes         && <MedRow label="SEND"       value={detail.send_notes} />}
                                {(detail.ec1_name || detail.ec1_phone) && (
                                  <MedRow label="Emergency contact"
                                    value={[detail.ec1_name, detail.ec1_relationship, detail.ec1_phone].filter(Boolean).join(" · ")} />
                                )}
                                {(detail.guardian_first_name || detail.guardian_phone) && (
                                  <MedRow label="Parent / guardian"
                                    value={[detail.guardian_first_name, detail.guardian_last_name, detail.guardian_phone].filter(Boolean).join(" ")} />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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

function MedRow({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-body)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: "var(--font-body)", lineHeight: 1.4 }}>{value}</span>
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

function ShopItemRow({ item, isFirst, onOrder }) {
  const [qty,     setQty]     = useState(1);
  const [saving,  setSaving]  = useState(false);
  const [ordered, setOrdered] = useState(false);

  const handleBuy = async () => {
    if (saving || ordered) return;
    setSaving(true);
    try {
      await onOrder(qty);
      setOrdered(true);
    } catch (e) {
      console.error("[shop] row buy failed", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: "12px 14px",
      borderTop: isFirst ? "none" : "1px solid var(--border-subtle)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", fontFamily: "var(--font-body)" }}>{item.name}</div>
        {item.description && (
          <div style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 2 }}>{item.description}</div>
        )}
        <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", marginTop: 3 }}>
          £{(item.price_pence / 100).toFixed(2)}
          {item.stock_qty != null && item.stock_qty <= 5 && item.stock_qty > 0 && (
            <span style={{ marginLeft: 8, color: "var(--amber, #f90)" }}>Only {item.stock_qty} left</span>
          )}
          {item.stock_qty === 0 && (
            <span style={{ marginLeft: 8, color: "#FF6060" }}>Out of stock</span>
          )}
        </div>
      </div>
      {item.stock_qty !== 0 && !ordered && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select value={qty} onChange={(e) => setQty(Number(e.target.value))}
            style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "var(--b2)", color: "var(--t1)", fontSize: 13, fontFamily: "var(--font-body)" }}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={handleBuy} disabled={saving}
            style={{
              padding: "7px 14px", borderRadius: 8, background: "var(--accent, #60A0FF)", color: "#fff",
              border: "none", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1, fontFamily: "var(--font-body)",
            }}>
            {saving ? "…" : "Order"}
          </button>
        </div>
      )}
      {ordered && (
        <span style={{ fontSize: 12, color: "rgba(76,175,80,1)", fontFamily: "var(--font-body)", fontWeight: 600 }}>Ordered ✓</span>
      )}
    </div>
  );
}
