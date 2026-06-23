import React, { useEffect, useRef, useState } from "react";
import ClubNavBar from "../components/ui/ClubNavBar.jsx";
import Tour from "../components/Tour.jsx";
import { clubToursEnabled } from "../lib/tourRegistry.js";
import {
  memberGetSelf, memberListChildren,
  memberListUpcomingSessions, memberRsvpSession, memberGetSessionRsvpBoard,
  clubManagerCreateSession, clubManagerCreateSessionSeries, clubManagerCancelSession,
  clubManagerGetTeamMembers, clubManagerAddSessionGuest, clubManagerRemoveSessionGuest,
  clubManagerMarkAttendance, clubManagerGetMemberDetail,
  clubManagerSendAnnouncement,
  clubManagerTeamPayments,
  memberListClubAnnouncements,
  memberGetMerchandise, memberPurchaseMerchandise,
  clubAdminListTournaments, clubAdminCreateTournament, clubAdminUpdateTournamentStatus,
  clubAdminGetTournament,
  clubAdminAddCompetition, clubAdminRegisterTeam,
  clubAdminSendTeamInvite, clubAdminApproveTeam, clubAdminRejectTeam,
  clubAdminGenerateSchedule, clubAdminGetSchedule,
  clubAdminSeedKnockout,
  clubAdminSeedDoubleElimination,
  clubAdminSetPerformanceConfig,
  clubAdminAddPerformanceEvent,
  clubAdminListPerformanceEvents,
  clubAdminRecordResult,
  clubAdminGetPerformanceResults,
  clubAdminGetSportsDayStandings,
  clubAdminAddSponsor,
  clubAdminListSponsors,
  clubAdminRemoveSponsor,
  uploadVenueMedia,
  clubAdminSetBranding,
  clubAdminSetPlayerOfTournament,
  clubAdminGetEquipmentForTournament,
  clubAdminBookEquipmentForTournament,
  clubAdminListTournamentEquipmentBookings,
  clubAdminCancelEquipmentBooking,
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

export default function SessionsScreen({ authUser, memberProfile: memberProfileProp, hasFeed = false }) {
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

  // manager → team message composer (Phase 4)
  const [composeTeamId, setComposeTeamId] = useState("");
  const [composeTitle,  setComposeTitle]  = useState("");
  const [composeBody,   setComposeBody]   = useState("");
  const [composeStatus, setComposeStatus] = useState(null); // null | 'sent' | 'error'
  const composeSavingRef = useRef(false);

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

  // seed knockout
  const [seedSaving, setSeedSaving]       = useState(false);
  const isSeedingRef                      = useRef(false);

  // performance events (Phase 6)
  const [perfEvents, setPerfEvents]             = useState([]);
  const [perfEventsLoading, setPerfEventsLoading] = useState(false);
  const [showAddEvent, setShowAddEvent]         = useState(false);
  const [eventForm, setEventForm]               = useState({ name:"", measurementType:"distance", unit:"", attemptsPerAthlete:1, category:"", scheduledTime:"", displayOrder:"" });
  const [eventSaving, setEventSaving]           = useState(false);
  const [eventError, setEventError]             = useState(null);
  const isEventSavingRef                        = useRef(false);
  const [expandedEventId, setExpandedEventId]   = useState(null);
  const [eventResults, setEventResults]         = useState({});
  const [resultForm, setResultForm]             = useState({ athleteName:"", teamId:"", value:"", attemptNumber:1, status:"recorded" });
  const [resultSaving, setResultSaving]         = useState(false);
  const [resultError, setResultError]           = useState(null);
  const isRecordingRef                          = useRef(false);
  const [sportsDayStandings, setSportsDayStandings] = useState(null);

  // Phase 7 Commercial — sponsors
  const [sponsors, setSponsors]               = useState([]);
  const [sponsorsLoading, setSponsorsLoading] = useState(false);
  const [sponsorForm, setSponsorForm]         = useState({ name: "", logoUrl: "", websiteUrl: "", displayOrder: 0 });
  const [sponsorSaving, setSponsorSaving]     = useState(false);
  const [showAddSponsor, setShowAddSponsor]   = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [heroUploading, setHeroUploading]     = useState(false);
  const [tournamentVenueId, setTournamentVenueId] = useState(null);
  const isSponsorSavingRef                    = useRef(false);
  const isRemovingSponsorRef                  = useRef(false);

  // Phase 7 Commercial — branding
  const [brandingForm, setBrandingForm]   = useState({ primaryColour: "", secondaryColour: "", customLogoUrl: "", tagline: "", heroUrl: "" });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const isBrandingSavingRef               = useRef(false);

  // Phase 7 Commercial — player of tournament
  const [potName, setPotName]     = useState("");
  const [potTeam, setPotTeam]     = useState("");
  const [potSaving, setPotSaving] = useState(false);
  const isPotSavingRef            = useRef(false);

  // Phase 7 Commercial — equipment
  const [equipmentItems, setEquipmentItems]     = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentBookings, setEquipmentBookings] = useState([]);
  const [bookingForm, setBookingForm]           = useState({ equipmentId: "", qty: 1, startAt: "", endAt: "", dueBackAt: "" });
  const [bookingSaving, setBookingSaving]       = useState(false);
  const [bookingError, setBookingError]         = useState(null);
  const isBookingRef                            = useRef(false);

  // Load profile + children on mount (skip profile fetch if prop provided)
  useEffect(() => {
    // Honour a ?club=<id> deep-link (from the switcher / a tapped club card) so
    // multi-club members land on the club they chose, not always the first.
    // Falls back to single-club auto-select. (Multi-context nav, Phase 1 bug fix.)
    const urlClub = (typeof window !== "undefined")
      ? new URLSearchParams(window.location.search).get("club")
      : null;
    const pickClub = (clubs) => {
      if (urlClub && clubs.some(c => c.club_id === urlClub)) return urlClub;
      if (clubs.length === 1) return clubs[0].club_id;
      return null;
    };
    if (memberProfileProp) {
      const clubs = memberProfileProp.active_clubs ?? [];
      const sel = pickClub(clubs);
      if (sel) setSelectedClubId(sel);
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
        const sel = pickClub(clubs);
        if (sel) setSelectedClubId(sel);
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
    setComposeTeamId("");
    setComposeTitle("");
    setComposeBody("");
    setComposeStatus(null);
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
      setPerfEvents([]);
      setSportsDayStandings(null);
      setSponsors([]);
      setEquipmentBookings([]);
      setEquipmentItems([]);
      setBrandingForm({ primaryColour: "", secondaryColour: "", customLogoUrl: "", tagline: "", heroUrl: "" });
      setPotName("");
      setPotTeam("");
      return;
    }
    setExpandedTournamentId(t.tournament_id);
    setTournamentVenueId(t.venue_id ?? null);
    setTournamentDetail(null);
    setScheduleData(null);
    setPerfEvents([]);
    setSportsDayStandings(null);
    setSponsors([]);
    setEquipmentBookings([]);
    setEquipmentItems([]);
    setDetailLoading(true);
    setScheduleLoading(true);
    setPerfEventsLoading(true);
    setSponsorsLoading(true);
    try {
      const [detail, schedule, events, sponsorList] = await Promise.all([
        clubAdminGetTournament(t.slug),
        clubAdminGetSchedule(t.tournament_id),
        clubAdminListPerformanceEvents(t.tournament_id),
        clubAdminListSponsors(t.tournament_id),
      ]);
      setTournamentDetail(detail);
      setScheduleData(schedule);
      setPerfEvents(Array.isArray(events) ? events : []);
      setSponsors(Array.isArray(sponsorList) ? sponsorList : []);
      const br = detail?.branding ?? {};
      setBrandingForm({
        primaryColour:   br.primary_colour   ?? "",
        secondaryColour: br.secondary_colour ?? "",
        customLogoUrl:   br.custom_logo_url  ?? "",
        tagline:         br.tagline          ?? "",
        heroUrl:         br.hero_url         ?? "",
      });
      setPotName(detail?.player_of_tournament_name ?? "");
      setPotTeam(detail?.player_of_tournament_team ?? "");
    } catch (e) {
      console.error("[sessions] tournament detail failed", e);
    } finally {
      setDetailLoading(false);
      setScheduleLoading(false);
      setPerfEventsLoading(false);
      setSponsorsLoading(false);
    }
  };

  const reloadDetail = async (slug, tournamentId) => {
    try {
      const [detail, schedule, events] = await Promise.all([
        clubAdminGetTournament(slug),
        clubAdminGetSchedule(tournamentId),
        clubAdminListPerformanceEvents(tournamentId),
      ]);
      setTournamentDetail(detail);
      setScheduleData(schedule);
      setPerfEvents(Array.isArray(events) ? events : []);
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

  const handleSeedKnockout = async (competitionId) => {
    if (isSeedingRef.current || !tournamentDetail) return;
    isSeedingRef.current = true;
    setSeedSaving(competitionId);
    try {
      await clubAdminSeedKnockout(tournamentDetail.tournament_id, competitionId);
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] seed knockout failed", e);
    } finally {
      setSeedSaving(false);
      isSeedingRef.current = false;
    }
  };

  const handleSeedDoubleElimination = async (competitionId) => {
    if (isSeedingRef.current || !tournamentDetail) return;
    isSeedingRef.current = true;
    setSeedSaving(competitionId);
    try {
      await clubAdminSeedDoubleElimination(tournamentDetail.tournament_id, competitionId);
      await reloadDetail(tournamentDetail.slug, tournamentDetail.tournament_id);
    } catch (e) {
      console.error("[sessions] seed DE failed", e);
    } finally {
      setSeedSaving(false);
      isSeedingRef.current = false;
    }
  };

  const handleAddPerformanceEvent = async () => {
    if (isEventSavingRef.current || !tournamentDetail) return;
    const name = eventForm.name.trim();
    if (!name) { setEventError("Event name required."); return; }
    if (!eventForm.unit.trim()) { setEventError("Unit required (e.g. m, s, kg)."); return; }
    isEventSavingRef.current = true;
    setEventSaving(true);
    setEventError(null);
    try {
      await clubAdminAddPerformanceEvent(
        tournamentDetail.tournament_id,
        name,
        eventForm.measurementType,
        eventForm.unit.trim(),
        parseInt(eventForm.attemptsPerAthlete, 10) || 1,
        eventForm.category.trim() || null,
        eventForm.scheduledTime || null,
        eventForm.displayOrder !== "" ? parseInt(eventForm.displayOrder, 10) : null,
      );
      setShowAddEvent(false);
      setEventForm({ name:"", measurementType:"distance", unit:"", attemptsPerAthlete:1, category:"", scheduledTime:"", displayOrder:"" });
      const events = await clubAdminListPerformanceEvents(tournamentDetail.tournament_id);
      setPerfEvents(Array.isArray(events) ? events : []);
    } catch (e) {
      console.error("[sessions] add performance event failed", e);
      setEventError(e?.message || "Failed to add event.");
    } finally {
      setEventSaving(false);
      isEventSavingRef.current = false;
    }
  };

  const toggleEventExpand = async (eventId) => {
    if (expandedEventId === eventId) { setExpandedEventId(null); return; }
    setExpandedEventId(eventId);
    if (!eventResults[eventId]) {
      try {
        const results = await clubAdminGetPerformanceResults(eventId);
        setEventResults(prev => ({ ...prev, [eventId]: Array.isArray(results) ? results : [] }));
      } catch (e) {
        console.error("[sessions] get performance results failed", e);
      }
    }
    const stands = await clubAdminGetSportsDayStandings(tournamentDetail.tournament_id).catch(e => { console.error(e); return null; });
    if (stands) setSportsDayStandings(Array.isArray(stands) ? stands : []);
  };

  const handleRecordResult = async () => {
    if (isRecordingRef.current || !expandedEventId) return;
    const name = resultForm.athleteName.trim();
    if (!name) { setResultError("Athlete name required."); return; }
    if (!resultForm.teamId) { setResultError("Team required."); return; }
    if (resultForm.status === "recorded" && resultForm.value === "") { setResultError("Value required."); return; }
    isRecordingRef.current = true;
    setResultSaving(true);
    setResultError(null);
    try {
      await clubAdminRecordResult(
        expandedEventId,
        name,
        resultForm.teamId,
        resultForm.status === "recorded" ? parseFloat(resultForm.value) : null,
        parseInt(resultForm.attemptNumber, 10) || 1,
        resultForm.status,
      );
      setResultForm({ athleteName:"", teamId: resultForm.teamId, value:"", attemptNumber:1, status:"recorded" });
      const [results, stands] = await Promise.all([
        clubAdminGetPerformanceResults(expandedEventId),
        clubAdminGetSportsDayStandings(tournamentDetail.tournament_id),
      ]);
      setEventResults(prev => ({ ...prev, [expandedEventId]: Array.isArray(results) ? results : [] }));
      if (stands) setSportsDayStandings(Array.isArray(stands) ? stands : []);
    } catch (e) {
      console.error("[sessions] record result failed", e);
      setResultError(e?.message || "Failed to record result.");
    } finally {
      setResultSaving(false);
      isRecordingRef.current = false;
    }
  };

  const handleAddSponsor = async () => {
    if (isSponsorSavingRef.current || !tournamentDetail) return;
    const name = sponsorForm.name.trim();
    if (!name) return;
    isSponsorSavingRef.current = true;
    setSponsorSaving(true);
    try {
      await clubAdminAddSponsor(
        tournamentDetail.tournament_id,
        name,
        sponsorForm.logoUrl.trim() || null,
        sponsorForm.websiteUrl.trim() || null,
        Number(sponsorForm.displayOrder) || 0,
      );
      setSponsorForm({ name: "", logoUrl: "", websiteUrl: "", displayOrder: 0 });
      setShowAddSponsor(false);
      const list = await clubAdminListSponsors(tournamentDetail.tournament_id);
      setSponsors(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("[sessions] add sponsor failed", e);
    } finally {
      setSponsorSaving(false);
      isSponsorSavingRef.current = false;
    }
  };

  const handleBannerUpload = async (file) => {
    if (!file) return;
    const venueId = tournamentVenueId || tournamentDetail?.venue_id;
    if (!venueId) { console.error("[sessions] banner upload — no venue id"); return; }
    setBannerUploading(true);
    try {
      const url = await uploadVenueMedia(venueId, file);
      if (url) setSponsorForm(f => ({ ...f, logoUrl: url }));
    } catch (e) {
      console.error("[sessions] banner upload failed", e);
    } finally {
      setBannerUploading(false);
    }
  };

  const handleHeroUpload = async (file) => {
    if (!file) return;
    const venueId = tournamentVenueId || tournamentDetail?.venue_id;
    if (!venueId) { console.error("[sessions] hero upload — no venue id"); return; }
    setHeroUploading(true);
    try {
      const url = await uploadVenueMedia(venueId, file);
      if (url) setBrandingForm(f => ({ ...f, heroUrl: url }));
    } catch (e) {
      console.error("[sessions] hero upload failed", e);
    } finally {
      setHeroUploading(false);
    }
  };

  const handleRemoveSponsor = async (sponsorId) => {
    if (isRemovingSponsorRef.current || !tournamentDetail) return;
    isRemovingSponsorRef.current = true;
    try {
      await clubAdminRemoveSponsor(sponsorId);
      const list = await clubAdminListSponsors(tournamentDetail.tournament_id);
      setSponsors(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("[sessions] remove sponsor failed", e);
    } finally {
      isRemovingSponsorRef.current = false;
    }
  };

  const handleSaveBranding = async () => {
    if (isBrandingSavingRef.current || !tournamentDetail) return;
    isBrandingSavingRef.current = true;
    setBrandingSaving(true);
    try {
      await clubAdminSetBranding(tournamentDetail.tournament_id, {
        primaryColour:   brandingForm.primaryColour.trim()   || null,
        secondaryColour: brandingForm.secondaryColour.trim() || null,
        customLogoUrl:   brandingForm.customLogoUrl.trim()   || null,
        tagline:         brandingForm.tagline.trim()         || null,
        heroUrl:         brandingForm.heroUrl.trim()         || null,
      });
    } catch (e) {
      console.error("[sessions] set branding failed", e);
    } finally {
      setBrandingSaving(false);
      isBrandingSavingRef.current = false;
    }
  };

  const handleSavePot = async () => {
    if (isPotSavingRef.current || !tournamentDetail) return;
    const name = potName.trim();
    if (!name) return;
    isPotSavingRef.current = true;
    setPotSaving(true);
    try {
      await clubAdminSetPlayerOfTournament(tournamentDetail.tournament_id, name, potTeam.trim() || null);
    } catch (e) {
      console.error("[sessions] set player of tournament failed", e);
    } finally {
      setPotSaving(false);
      isPotSavingRef.current = false;
    }
  };

  const loadEquipment = async () => {
    if (!tournamentDetail) return;
    setEquipmentLoading(true);
    try {
      const [items, bookings] = await Promise.all([
        clubAdminGetEquipmentForTournament(tournamentDetail.tournament_id),
        clubAdminListTournamentEquipmentBookings(tournamentDetail.tournament_id),
      ]);
      setEquipmentItems(Array.isArray(items) ? items : []);
      setEquipmentBookings(Array.isArray(bookings) ? bookings : []);
    } catch (e) {
      console.error("[sessions] load equipment failed", e);
    } finally {
      setEquipmentLoading(false);
    }
  };

  const handleBookEquipment = async () => {
    if (isBookingRef.current || !tournamentDetail) return;
    if (!bookingForm.equipmentId) { setBookingError("Select an item."); return; }
    if (!bookingForm.startAt || !bookingForm.endAt) { setBookingError("Start and end time required."); return; }
    isBookingRef.current = true;
    setBookingSaving(true);
    setBookingError(null);
    try {
      await clubAdminBookEquipmentForTournament(
        tournamentDetail.tournament_id,
        bookingForm.equipmentId,
        Number(bookingForm.qty) || 1,
        bookingForm.startAt,
        bookingForm.endAt,
        bookingForm.dueBackAt || null,
      );
      setBookingForm({ equipmentId: "", qty: 1, startAt: "", endAt: "", dueBackAt: "" });
      const bookings = await clubAdminListTournamentEquipmentBookings(tournamentDetail.tournament_id);
      setEquipmentBookings(Array.isArray(bookings) ? bookings : []);
    } catch (e) {
      console.error("[sessions] book equipment failed", e);
      setBookingError(e?.message ?? "Booking failed — check availability.");
    } finally {
      setBookingSaving(false);
      isBookingRef.current = false;
    }
  };

  const handleCancelEquipmentBooking = async (bookingId) => {
    if (isBookingRef.current || !tournamentDetail) return;
    isBookingRef.current = true;
    try {
      await clubAdminCancelEquipmentBooking(bookingId);
      const bookings = await clubAdminListTournamentEquipmentBookings(tournamentDetail.tournament_id);
      setEquipmentBookings(Array.isArray(bookings) ? bookings : []);
    } catch (e) {
      console.error("[sessions] cancel equipment booking failed", e);
    } finally {
      isBookingRef.current = false;
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
    location, notes, capacity, meetTime, opponentName, homeAway, opponentVenueName, opponentAddress, venueId }) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setCreateLoading(true);
    try {
      await clubManagerCreateSession(teamId, {
        title, scheduledAt, sessionType, location, notes, capacity,
        meetTime, opponentName, homeAway, opponentVenueName, opponentAddress, venueId,
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

  const handleCreateSeries = async ({ teamId, title, sessionType, dayOfWeek, startTime, fromDate, toDate, location, notes, capacity, venueId }) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setCreateLoading(true);
    try {
      await clubManagerCreateSessionSeries(teamId, {
        title, sessionType, dayOfWeek, startTime, fromDate, toDate, location, notes, capacity, venueId,
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

  const handleSendTeamMessage = async () => {
    if (composeSavingRef.current) return;
    if (!composeTeamId || !composeTitle.trim() || !composeBody.trim()) return;
    composeSavingRef.current = true;
    setComposeStatus(null);
    try {
      await clubManagerSendAnnouncement(composeTeamId, composeTitle.trim(), composeBody.trim());
      setComposeTitle("");
      setComposeBody("");
      setComposeStatus("sent");
    } catch (e) {
      console.error("[sessions] send team message failed", e);
      setComposeStatus("error");
    } finally {
      composeSavingRef.current = false;
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

  const activeClubs = memberProfile?.active_clubs ?? [];
  // No member profile / no active clubs → empty state, NOT a blank page. A
  // signed-in user with the multi-context nav but no club membership lands here
  // (e.g. fresh OAuth identity); returning null rendered an all-black screen.
  if (!memberProfile || activeClubs.length === 0) return (
    <div style={wrap}>
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "calc(20px + env(safe-area-inset-top)) 20px 16px",
      }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>
          Sessions
        </div>
      </div>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", flex: 1, gap: 12, padding: "40px 24px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40 }}>🎟️</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)" }}>
          No clubs yet
        </div>
        <p style={{
          color: "var(--t2)", fontFamily: "var(--font-body)", fontSize: 14,
          lineHeight: 1.5, maxWidth: 280, margin: 0,
        }}>
          When you join a club, its training sessions, tournaments and bookings show up here.
        </p>
      </div>
      <ClubNavBar active="sessions" hasFeed={hasFeed} />
    </div>
  );

  const selectedClub = activeClubs.find(c => c.club_id === selectedClubId) ?? null;
  const isManager = (memberProfile.managed_teams ?? []).some(t => t.club_id === selectedClubId);
  const managedTeamsForClub = (memberProfile.managed_teams ?? []).filter(t => t.club_id === selectedClubId);
  // The club's venues (multi-venue, same-operator) — feeds the manager venue picker.
  const clubVenuesForClub = memberProfile.active_clubs?.find(c => c.club_id === selectedClubId)?.venues ?? [];
  const isManagerOfSession = (session) => !!session?.team_id && managedTeamsForClub.some(t => t.team_id === session.team_id);

  return (
    <div style={wrap}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "calc(20px + env(safe-area-inset-top)) 20px 16px",
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

      {/* ── Manager → team message composer (Phase 4) ───────────────────── */}
      {isManager && selectedClubId && activeTab === "sessions" && managedTeamsForClub.length > 0 && (() => {
        const effectiveTeamId = composeTeamId || managedTeamsForClub[0].team_id;
        const canSend = !!effectiveTeamId && composeTitle.trim() && composeBody.trim();
        return (
          <div style={{ padding: "12px 20px 0" }}>
            <div style={{
              background: "var(--b2)", border: "1px solid var(--border-subtle)",
              borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                  Message your team
                </span>
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", margin: 0, lineHeight: 1.4 }}>
                  Sends an email to this team's players and their guardians. Example: a kick-off
                  time change or a kit reminder.
                </p>
                {managedTeamsForClub.length > 1 && (
                  <select
                    value={effectiveTeamId}
                    onChange={e => setComposeTeamId(e.target.value)}
                    style={{
                      fontSize: 14, fontFamily: "var(--font-body)", color: "var(--t1)",
                      background: "var(--b1)", border: "1px solid var(--border)",
                      borderRadius: 8, padding: "9px 11px",
                    }}
                  >
                    {managedTeamsForClub.map(t => (
                      <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={composeTitle}
                  onChange={e => { setComposeTitle(e.target.value); setComposeStatus(null); }}
                  placeholder="Title — e.g. Saturday kick-off moved to 10am"
                  maxLength={120}
                  style={{
                    fontSize: 14, fontFamily: "var(--font-body)", color: "var(--t1)",
                    background: "var(--b1)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "9px 11px",
                  }}
                />
                <textarea
                  value={composeBody}
                  onChange={e => { setComposeBody(e.target.value); setComposeStatus(null); }}
                  placeholder="Message — e.g. Please arrive 15 minutes early to warm up. Bring both kits."
                  rows={4}
                  style={{
                    fontSize: 14, fontFamily: "var(--font-body)", color: "var(--t1)",
                    background: "var(--b1)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "9px 11px", resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 12, fontFamily: "var(--font-body)" }}>
                    {composeStatus === "sent" && <span style={{ color: "var(--green)" }}>Message sent — it'll email shortly.</span>}
                    {composeStatus === "error" && <span style={{ color: "#FF6060" }}>Couldn't send — please try again.</span>}
                  </span>
                  <button
                    onClick={handleSendTeamMessage}
                    disabled={!canSend}
                    style={{
                      fontSize: 13, fontWeight: 700, fontFamily: "var(--font-body)",
                      background: canSend ? "var(--amber)" : "rgba(255,255,255,0.08)",
                      color: canSend ? "rgba(0,0,0,0.9)" : "var(--t2)",
                      border: `1px solid ${canSend ? "var(--amber)" : "var(--border)"}`,
                      padding: "8px 16px", borderRadius: 20,
                      cursor: canSend ? "pointer" : "default",
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
            <TeamPaymentsCard teamId={effectiveTeamId} />
          </div>
        );
      })()}

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
                              {fixtures.length === 0 && activeTeams.length >= 2 && comp.format !== "double_elimination" && (
                                <div style={{ marginTop: 8 }}>
                                  <button
                                    onClick={() => { setGenCompId(comp.competition_id); setGenForm({ slotMinutes: 45, startTime: "09:00", startDate: "" }); setGenPitchIds([]); setGenError(null); setShowGenModal(true); }}
                                    style={{ fontSize: 12, fontWeight: 700, background: "rgba(96,160,255,0.12)", border: "1px solid rgba(96,160,255,0.3)", color: "#60A0FF", padding: "6px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                  >
                                    Generate schedule
                                  </button>
                                </div>
                              )}

                              {fixtures.length === 0 && comp.format === "double_elimination" && activeTeams.length >= 4 && !comp.knockout_seeded && (
                                <div style={{ marginTop: 8 }}>
                                  <button
                                    onClick={() => handleSeedDoubleElimination(comp.competition_id)}
                                    disabled={seedSaving === comp.competition_id}
                                    style={{ fontSize: 12, fontWeight: 700, background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)", color: "rgba(76,175,80,1)", padding: "6px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: seedSaving === comp.competition_id ? "not-allowed" : "pointer" }}
                                  >
                                    {seedSaving === comp.competition_id ? "Seeding…" : "Seed double elimination"}
                                  </button>
                                </div>
                              )}

                              {fixtures.length > 0 && (() => {
                                const groupFx    = fixtures.filter(fx => fx.group_label != null);
                                const knockoutFx = fixtures.filter(fx => fx.group_label == null);
                                // Standings from group-stage fixtures only
                                const completedGroupFx = groupFx.filter(fx => fx.status === "completed" && fx.home_score != null && fx.away_score != null);
                                const standingsMap = {};
                                activeTeams.forEach(tm => {
                                  standingsMap[tm.competition_team_id] = { id: tm.competition_team_id, name: tm.team_name, groupLabel: tm.group_label, groupRank: tm.group_rank, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 };
                                });
                                completedGroupFx.forEach(fx => {
                                  const h = standingsMap[fx.home_team_id], a = standingsMap[fx.away_team_id];
                                  if (h) { h.P++; h.GF += fx.home_score; h.GA += fx.away_score; if (fx.home_score > fx.away_score) h.W++; else if (fx.home_score === fx.away_score) h.D++; else h.L++; }
                                  if (a) { a.P++; a.GF += fx.away_score; a.GA += fx.home_score; if (fx.away_score > fx.home_score) a.W++; else if (fx.home_score === fx.away_score) a.D++; else a.L++; }
                                });
                                const allStandings = Object.values(standingsMap).sort((a, b) => {
                                  if ((a.groupLabel ?? "") < (b.groupLabel ?? "")) return -1;
                                  if ((a.groupLabel ?? "") > (b.groupLabel ?? "")) return 1;
                                  const pa = a.W * 3 + a.D, pb = b.W * 3 + b.D;
                                  if (pa !== pb) return pb - pa;
                                  const h2hFx = completedGroupFx.filter(fx =>
                                    (fx.home_team_id === a.id && fx.away_team_id === b.id) ||
                                    (fx.away_team_id === a.id && fx.home_team_id === b.id)
                                  );
                                  const ha = { pts: 0, gd: 0, gf: 0 }, hb = { pts: 0, gd: 0, gf: 0 };
                                  h2hFx.forEach(fx => {
                                    const aIsHome = fx.home_team_id === a.id;
                                    const ag = aIsHome ? fx.home_score : fx.away_score;
                                    const bg = aIsHome ? fx.away_score : fx.home_score;
                                    if (ag > bg) { ha.pts += 3; } else if (ag === bg) { ha.pts += 1; hb.pts += 1; } else { hb.pts += 3; }
                                    ha.gd += ag - bg; hb.gd += bg - ag;
                                    ha.gf += ag; hb.gf += bg;
                                  });
                                  if (ha.pts !== hb.pts) return hb.pts - ha.pts;
                                  if (ha.gd !== hb.gd) return hb.gd - ha.gd;
                                  if (ha.gf !== hb.gf) return hb.gf - ha.gf;
                                  const gda = a.GF - a.GA, gdb = b.GF - b.GA;
                                  if (gda !== gdb) return gdb - gda;
                                  return b.GF - a.GF;
                                });
                                // Group fixtures by round (group-stage only)
                                const groupFxByRound = groupFx.reduce((acc, fx) => {
                                  const k = fx.round_name || `Round ${fx.round}`;
                                  if (!acc[k]) acc[k] = [];
                                  acc[k].push(fx);
                                  return acc;
                                }, {});
                                // Knockout fixtures by round
                                const knockoutFxByRound = knockoutFx.reduce((acc, fx) => {
                                  const k = fx.round_name || `Round ${fx.round}`;
                                  if (!acc[k]) acc[k] = [];
                                  acc[k].push(fx);
                                  return acc;
                                }, {});
                                // Check if knockout can be seeded
                                const allGroupComplete = groupFx.length > 0 && groupFx.every(fx => fx.status === "completed");
                                const canSeedKnockout  = allGroupComplete && !comp.knockout_seeded;
                                // Group standings by group_label
                                const standingsByGroup = {};
                                allStandings.forEach(row => {
                                  const g = row.groupLabel ?? "_";
                                  if (!standingsByGroup[g]) standingsByGroup[g] = [];
                                  standingsByGroup[g].push(row);
                                });
                                return (
                                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                                    {/* Group-stage rounds */}
                                    {Object.entries(groupFxByRound).map(([roundName, roundFixtures]) => (
                                      <div key={roundName}>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>{roundName}</div>
                                        {roundFixtures.map(fx => (
                                          <div key={fx.fixture_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                            {fx.group_label && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, letterSpacing: 0.5, textTransform: "uppercase" }}>{fx.group_label}</span>}
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

                                    {/* Per-group standings — shown once any group fixture is complete */}
                                    {completedGroupFx.length > 0 && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        {Object.entries(standingsByGroup).map(([groupLabel, rows]) => (
                                          <div key={groupLabel} style={{ marginTop: 4 }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>
                                              {groupLabel === "_" ? "Standings" : `Group ${groupLabel}`}
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(6,28px)", gap: 0, fontSize: 10, fontFamily: "var(--font-body)" }}>
                                              <span style={{ color: "var(--t3, #666)", padding: "2px 0" }}>Team</span>
                                              {["P","W","D","L","GD","Pts"].map(h => (
                                                <span key={h} style={{ color: "var(--t3, #666)", textAlign: "right", padding: "2px 0" }}>{h}</span>
                                              ))}
                                              {rows.map(row => {
                                                const pts = row.W * 3 + row.D;
                                                const isAdvancing = comp.knockout_seeded && row.groupRank != null && row.groupRank <= 2;
                                                return [
                                                  <span key={row.name + "n"} style={{ color: "var(--t1)", padding: "3px 0", borderTop: "1px solid var(--border-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                                                    {row.groupRank != null && <span style={{ fontSize: 9, fontWeight: 700, color: isAdvancing ? "rgba(76,175,80,0.8)" : "var(--t3, #666)", flexShrink: 0 }}>{row.groupRank}</span>}
                                                    {row.name}
                                                    {isAdvancing && <span style={{ fontSize: 9, color: "rgba(76,175,80,0.8)", fontWeight: 700, flexShrink: 0 }}>ADV</span>}
                                                  </span>,
                                                  ...[row.P, row.W, row.D, row.L, row.GF - row.GA, pts].map((v, i) => (
                                                    <span key={row.name + i} style={{ color: i === 5 ? "var(--t1)" : "var(--t2)", fontWeight: i === 5 ? 700 : 400, textAlign: "right", padding: "3px 0", borderTop: "1px solid var(--border-subtle)" }}>{v > 0 && i === 4 ? `+${v}` : v}</span>
                                                  ))
                                                ];
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Advance to Knockout button */}
                                    {canSeedKnockout && (
                                      <div style={{ marginTop: 4 }}>
                                        <button
                                          onClick={() => handleSeedKnockout(comp.competition_id)}
                                          disabled={seedSaving === comp.competition_id}
                                          style={{ fontSize: 12, fontWeight: 700, background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)", color: "rgba(76,175,80,1)", padding: "6px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: seedSaving === comp.competition_id ? "not-allowed" : "pointer" }}
                                        >
                                          {seedSaving === comp.competition_id ? "Seeding…" : "Advance to Knockout"}
                                        </button>
                                      </div>
                                    )}

                                    {/* Knockout / DE bracket rounds */}
                                    {comp.knockout_seeded && knockoutFx.length > 0 && comp.format !== "double_elimination" && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,190,60,0.8)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Knockout Stage</div>
                                        {Object.entries(knockoutFxByRound).map(([roundName, roundFixtures]) => (
                                          <div key={roundName}>
                                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>{roundName}</div>
                                            {roundFixtures.map(fx => (
                                              <div key={fx.fixture_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                                <span style={{ fontSize: 12, color: fx.home_team_name ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: fx.home_team_name ? "normal" : "italic" }}>{fx.home_team_name ?? "TBD"}</span>
                                                <span style={{ fontSize: 10, color: fx.home_score != null ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, fontWeight: fx.home_score != null ? 700 : 400 }}>
                                                  {fx.home_score != null ? `${fx.home_score}–${fx.away_score}` : "vs"}
                                                </span>
                                                <span style={{ fontSize: 12, color: fx.away_team_name ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", fontStyle: fx.away_team_name ? "normal" : "italic" }}>{fx.away_team_name ?? "TBD"}</span>
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
                                      </div>
                                    )}

                                    {/* Double-elimination bracket: WB / LB / Grand Final sections */}
                                    {comp.knockout_seeded && knockoutFx.length > 0 && comp.format === "double_elimination" && (() => {
                                      const wbFx = knockoutFx.filter(fx => fx.de_bracket === "winners");
                                      const lbFx = knockoutFx.filter(fx => fx.de_bracket === "losers");
                                      const gfFx = knockoutFx.filter(fx => fx.de_bracket === "grand_final");
                                      const wbByRound = wbFx.reduce((acc, fx) => { const k = fx.round_name || `Round ${fx.round}`; if (!acc[k]) acc[k] = []; acc[k].push(fx); return acc; }, {});
                                      const lbByRound = lbFx.reduce((acc, fx) => { const k = fx.round_name || `Round ${fx.round}`; if (!acc[k]) acc[k] = []; acc[k].push(fx); return acc; }, {});
                                      const deFxRow = (fx) => (
                                        <div key={fx.fixture_id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                          <span style={{ fontSize: 12, color: fx.home_team_name ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: fx.home_team_name ? "normal" : "italic" }}>{fx.home_team_name ?? "TBD"}</span>
                                          <span style={{ fontSize: 10, color: fx.home_score != null ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, fontWeight: fx.home_score != null ? 700 : 400 }}>
                                            {fx.home_score != null ? `${fx.home_score}–${fx.away_score}` : "vs"}
                                          </span>
                                          <span style={{ fontSize: 12, color: fx.away_team_name ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", fontStyle: fx.away_team_name ? "normal" : "italic" }}>{fx.away_team_name ?? "TBD"}</span>
                                          {fx.kickoff_time && <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, marginLeft: 4 }}>{fx.kickoff_time.slice(0,5)}</span>}
                                          {fx.pitch_name && <span style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0, marginLeft: 4 }}>· {fx.pitch_name}</span>}
                                          {fx.ref_token && (
                                            <button onClick={() => navigator.clipboard.writeText(`https://platform-ref.vercel.app/?token=${fx.ref_token}`)} style={{ fontSize: 10, fontWeight: 700, background: "rgba(96,160,255,0.1)", border: "1px solid rgba(96,160,255,0.25)", color: "#60A0FF", padding: "2px 7px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}>Ref</button>
                                          )}
                                        </div>
                                      );
                                      return (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                          {wbFx.length > 0 && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,190,60,0.8)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Winners Bracket</div>
                                              {Object.entries(wbByRound).map(([roundName, roundFixtures]) => (
                                                <div key={roundName}>
                                                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>{roundName}</div>
                                                  {roundFixtures.map(deFxRow)}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {lbFx.length > 0 && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,120,60,0.8)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Losers Bracket</div>
                                              {Object.entries(lbByRound).map(([roundName, roundFixtures]) => (
                                                <div key={roundName}>
                                                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 4 }}>{roundName}</div>
                                                  {roundFixtures.map(deFxRow)}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {gfFx.length > 0 && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,215,0,0.9)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Grand Final</div>
                                              {gfFx.map(deFxRow)}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}

                        {/* ── Performance Events (Phase 6 — sports day / athletics) ── */}
                        <div style={{ marginTop: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                              Performance Events
                            </span>
                            <button
                              onClick={() => { setShowAddEvent(true); setEventError(null); setEventForm({ name:"", measurementType:"distance", unit:"", attemptsPerAthlete:1, category:"", scheduledTime:"", displayOrder:"" }); }}
                              style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--t1)", padding: "3px 10px", borderRadius: 16, fontFamily: "var(--font-body)", cursor: "pointer" }}
                            >
                              + Add Event
                            </button>
                          </div>

                          {perfEventsLoading && (
                            <p style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)", margin: 0 }}>Loading…</p>
                          )}
                          {!perfEventsLoading && perfEvents.length === 0 && (
                            <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", margin: 0 }}>No events yet. Add disciplines (100m, long jump, etc.) to start recording results.</p>
                          )}

                          {perfEvents.map(ev => {
                            const isOpen = expandedEventId === ev.event_id;
                            const results = eventResults[ev.event_id] ?? [];
                            const allTeams = (tournamentDetail.competitions ?? []).flatMap(c => (c.teams ?? []).filter(t => t.status === "active" || !t.status));
                            const mtLabel = { time_asc: "Time (lower=better)", time_desc: "Time (higher=better)", distance: "Distance", height: "Height", weight: "Weight" }[ev.measurement_type] ?? ev.measurement_type;
                            return (
                              <div key={ev.event_id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
                                <div
                                  onClick={() => toggleEventExpand(ev.event_id)}
                                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", cursor: "pointer" }}
                                >
                                  <div>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)" }}>{ev.name}</span>
                                    {ev.category && <span style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", marginLeft: 8 }}>{ev.category}</span>}
                                    <div style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", marginTop: 2 }}>{mtLabel} · {ev.unit} · {ev.attempts_per_athlete} attempt{ev.attempts_per_athlete !== 1 ? "s" : ""} · {ev.result_count} result{ev.result_count !== 1 ? "s" : ""}</div>
                                  </div>
                                  <span style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)" }}>{isOpen ? "▲" : "▼"}</span>
                                </div>

                                {isOpen && (
                                  <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                                    {/* Leaderboard */}
                                    {results.length > 0 && (
                                      <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,190,60,0.8)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 6 }}>Leaderboard</div>
                                        {results.map((r, i) => (
                                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3, #666)", fontFamily: "var(--font-body)", width: 20, flexShrink: 0 }}>{r.rank ?? "—"}</span>
                                            <span style={{ fontSize: 12, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.athlete_name}</span>
                                            <span style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)" }}>{r.team_name}</span>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)", flexShrink: 0 }}>
                                              {r.status === "recorded" ? `${r.best_value} ${ev.unit}` : r.status?.toUpperCase()}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Record result form */}
                                    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Record Result</div>
                                      {resultError && expandedEventId === ev.event_id && (
                                        <div style={{ fontSize: 12, color: "#FF6060", fontFamily: "var(--font-body)" }}>{resultError}</div>
                                      )}
                                      <input
                                        placeholder="Athlete name"
                                        value={resultForm.athleteName}
                                        onChange={e => setResultForm(f => ({ ...f, athleteName: e.target.value }))}
                                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                                      />
                                      <select
                                        value={resultForm.teamId}
                                        onChange={e => setResultForm(f => ({ ...f, teamId: e.target.value }))}
                                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: resultForm.teamId ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", outline: "none" }}
                                      >
                                        <option value="">Select team</option>
                                        {allTeams.map(t => (
                                          <option key={t.competition_team_id} value={t.competition_team_id}>{t.team_name}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={resultForm.status}
                                        onChange={e => setResultForm(f => ({ ...f, status: e.target.value }))}
                                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                                      >
                                        <option value="recorded">Recorded</option>
                                        <option value="dns">DNS (Did Not Start)</option>
                                        <option value="dnf">DNF (Did Not Finish)</option>
                                        <option value="disqualified">Disqualified</option>
                                      </select>
                                      {resultForm.status === "recorded" && (
                                        <div style={{ display: "flex", gap: 8 }}>
                                          <input
                                            placeholder={`Value (${ev.unit})`}
                                            value={resultForm.value}
                                            onChange={e => setResultForm(f => ({ ...f, value: e.target.value }))}
                                            type="number"
                                            step="any"
                                            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 1 }}
                                          />
                                          <input
                                            placeholder="Attempt #"
                                            value={resultForm.attemptNumber}
                                            onChange={e => setResultForm(f => ({ ...f, attemptNumber: e.target.value }))}
                                            type="number"
                                            min="1"
                                            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: 90, flexShrink: 0 }}
                                          />
                                        </div>
                                      )}
                                      <button
                                        onClick={handleRecordResult}
                                        disabled={resultSaving}
                                        style={{ fontSize: 13, fontWeight: 700, background: "rgba(96,160,255,0.12)", border: "1px solid rgba(96,160,255,0.3)", color: "#60A0FF", padding: "8px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: resultSaving ? "not-allowed" : "pointer" }}
                                      >
                                        {resultSaving ? "Saving…" : "Save Result"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* ── Overall Sports Day Standings ── */}
                        {sportsDayStandings && sportsDayStandings.length > 0 && (
                          <div style={{ marginTop: 20 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 8 }}>
                              Sports Day Standings
                            </div>
                            {sportsDayStandings.map((row, i) => (
                              <div key={row.competition_team_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--t3, #666)", fontFamily: "var(--font-body)", width: 20, flexShrink: 0 }}>{i + 1}</span>
                                <span style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.team_name}</span>
                                <span style={{ fontSize: 11, color: "rgba(255,215,0,0.8)", fontFamily: "var(--font-body)", flexShrink: 0 }}>🥇{row.gold}</span>
                                <span style={{ fontSize: 11, color: "rgba(192,192,192,0.8)", fontFamily: "var(--font-body)", flexShrink: 0 }}>🥈{row.silver}</span>
                                <span style={{ fontSize: 11, color: "rgba(205,127,50,0.8)", fontFamily: "var(--font-body)", flexShrink: 0 }}>🥉{row.bronze}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)", flexShrink: 0, marginLeft: 4 }}>{row.points} pts</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ── Branding ── */}
                        <div style={{ marginTop: 20 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 8 }}>
                            Branding
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input
                                placeholder="Primary colour (e.g. #1a73e8)"
                                value={brandingForm.primaryColour}
                                onChange={e => setBrandingForm(f => ({ ...f, primaryColour: e.target.value }))}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 1 }}
                              />
                              <input
                                placeholder="Secondary colour"
                                value={brandingForm.secondaryColour}
                                onChange={e => setBrandingForm(f => ({ ...f, secondaryColour: e.target.value }))}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 1 }}
                              />
                            </div>
                            <input
                              placeholder="Custom logo URL (https://…)"
                              value={brandingForm.customLogoUrl}
                              onChange={e => setBrandingForm(f => ({ ...f, customLogoUrl: e.target.value }))}
                              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box" }}
                            />
                            <input
                              placeholder="Tagline / subheading (e.g. Eight teams. One day. One trophy.)"
                              value={brandingForm.tagline}
                              onChange={e => setBrandingForm(f => ({ ...f, tagline: e.target.value }))}
                              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box" }}
                            />
                            <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: "1px dashed var(--border)", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
                              {heroUploading ? "Uploading…" : (brandingForm.heroUrl ? "Replace hero background image" : "Upload hero background image")}
                              <input
                                type="file" accept="image/*" style={{ display: "none" }} disabled={heroUploading}
                                onChange={e => { const file = e.target.files?.[0]; if (file) handleHeroUpload(file); e.target.value = ""; }}
                              />
                            </label>
                            {brandingForm.heroUrl && (
                              <img src={brandingForm.heroUrl} alt="Hero preview" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border-subtle)", display: "block" }} />
                            )}
                            <input
                              placeholder="…or paste a hero image URL"
                              value={brandingForm.heroUrl}
                              onChange={e => setBrandingForm(f => ({ ...f, heroUrl: e.target.value }))}
                              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box" }}
                            />
                            <button
                              onClick={handleSaveBranding}
                              disabled={brandingSaving}
                              style={{ fontSize: 13, fontWeight: 700, background: "rgba(255,255,255,0.08)", border: "1px solid var(--border)", color: "var(--t1)", padding: "8px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: brandingSaving ? "not-allowed" : "pointer", alignSelf: "flex-start" }}
                            >
                              {brandingSaving ? "Saving…" : "Save branding"}
                            </button>
                          </div>
                        </div>

                        {/* ── Sponsors ── */}
                        <div style={{ marginTop: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                              Sponsors
                            </span>
                            <button
                              onClick={() => { setSponsorForm({ name: "", logoUrl: "", websiteUrl: "", displayOrder: 0 }); setShowAddSponsor(v => !v); }}
                              style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--t1)", padding: "3px 10px", borderRadius: 16, fontFamily: "var(--font-body)", cursor: "pointer" }}
                            >
                              + Add
                            </button>
                          </div>

                          {sponsorsLoading && <p style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)", margin: 0 }}>Loading…</p>}

                          {!sponsorsLoading && sponsors.length === 0 && !showAddSponsor && (
                            <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", margin: 0 }}>No sponsors yet.</p>
                          )}

                          {sponsors.map(sp => (
                            <div key={sp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                              {sp.logo_url && (
                                <img src={sp.logo_url} alt={sp.name} style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 4, flexShrink: 0 }} />
                              )}
                              <span style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {sp.name}
                              </span>
                              {sp.website_url && (
                                <span style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0 }}>↗</span>
                              )}
                              <button
                                onClick={() => handleRemoveSponsor(sp.id)}
                                style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", color: "var(--t2)", padding: "2px 8px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}

                          {showAddSponsor && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                              <input
                                placeholder="Sponsor name *"
                                value={sponsorForm.name}
                                onChange={e => setSponsorForm(f => ({ ...f, name: e.target.value }))}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                              />
                              <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(255,255,255,0.06)", border: "1px dashed var(--border)", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 700, color: "var(--t1)", fontFamily: "var(--font-body)", cursor: "pointer" }}>
                                {bannerUploading ? "Uploading…" : (sponsorForm.logoUrl ? "Replace banner image" : "Upload banner image (wide)")}
                                <input
                                  type="file" accept="image/*" style={{ display: "none" }} disabled={bannerUploading}
                                  onChange={e => { const file = e.target.files?.[0]; if (file) handleBannerUpload(file); e.target.value = ""; }}
                                />
                              </label>
                              {sponsorForm.logoUrl && (
                                <img src={sponsorForm.logoUrl} alt="Banner preview" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border-subtle)", display: "block" }} />
                              )}
                              <input
                                placeholder="…or paste a banner image URL"
                                value={sponsorForm.logoUrl}
                                onChange={e => setSponsorForm(f => ({ ...f, logoUrl: e.target.value }))}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                              />
                              <input
                                placeholder="Website URL (optional)"
                                value={sponsorForm.websiteUrl}
                                onChange={e => setSponsorForm(f => ({ ...f, websiteUrl: e.target.value }))}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                              />
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={handleAddSponsor}
                                  disabled={sponsorSaving || !sponsorForm.name.trim()}
                                  style={{ fontSize: 12, fontWeight: 700, background: "rgba(76,175,80,0.12)", border: "1px solid rgba(76,175,80,0.3)", color: "rgba(76,175,80,1)", padding: "8px 14px", borderRadius: 8, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                >
                                  {sponsorSaving ? "Saving…" : "Add sponsor"}
                                </button>
                                <button
                                  onClick={() => setShowAddSponsor(false)}
                                  style={{ fontSize: 12, background: "none", border: "1px solid var(--border)", color: "var(--t2)", padding: "8px 10px", borderRadius: 8, fontFamily: "var(--font-body)", cursor: "pointer" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── Player of Tournament ── */}
                        <div style={{ marginTop: 20 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 8 }}>
                            Player of Tournament
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <input
                                placeholder="Player name *"
                                value={potName}
                                onChange={e => setPotName(e.target.value)}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 2 }}
                              />
                              <input
                                placeholder="Team (optional)"
                                value={potTeam}
                                onChange={e => setPotTeam(e.target.value)}
                                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", flex: 1 }}
                              />
                            </div>
                            <button
                              onClick={handleSavePot}
                              disabled={potSaving || !potName.trim()}
                              style={{ fontSize: 13, fontWeight: 700, background: "rgba(255,255,255,0.08)", border: "1px solid var(--border)", color: "var(--t1)", padding: "8px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: potSaving ? "not-allowed" : "pointer", alignSelf: "flex-start" }}
                            >
                              {potSaving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>

                        {/* ── Equipment ── */}
                        <div style={{ marginTop: 20 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>
                              Equipment
                            </span>
                            {equipmentItems.length === 0 && !equipmentLoading && (
                              <button
                                onClick={loadEquipment}
                                style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--t2)", padding: "3px 10px", borderRadius: 16, fontFamily: "var(--font-body)", cursor: "pointer" }}
                              >
                                Load
                              </button>
                            )}
                          </div>

                          {equipmentLoading && <p style={{ fontSize: 12, color: "var(--t3, #666)", fontFamily: "var(--font-body)", margin: 0 }}>Loading…</p>}

                          {!equipmentLoading && equipmentItems.length > 0 && (
                            <>
                              {/* Booking form */}
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                                {bookingError && (
                                  <div style={{ fontSize: 12, color: "#FF6060", fontFamily: "var(--font-body)" }}>{bookingError}</div>
                                )}
                                <select
                                  value={bookingForm.equipmentId}
                                  onChange={e => setBookingForm(f => ({ ...f, equipmentId: e.target.value }))}
                                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: bookingForm.equipmentId ? "var(--t1)" : "var(--t3, #666)", fontFamily: "var(--font-body)", outline: "none" }}
                                >
                                  <option value="">Select equipment item</option>
                                  {equipmentItems.map(item => (
                                    <option key={item.equipment_id} value={item.equipment_id}>
                                      {item.name}{item.available_qty != null ? ` (${item.available_qty} avail)` : ""}
                                    </option>
                                  ))}
                                </select>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 70, flexShrink: 0 }}>
                                    <label style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)" }}>Qty</label>
                                    <input
                                      type="number" min="1" value={bookingForm.qty}
                                      onChange={e => setBookingForm(f => ({ ...f, qty: e.target.value }))}
                                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                                    <label style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)" }}>Start</label>
                                    <input
                                      type="datetime-local" value={bookingForm.startAt}
                                      onChange={e => setBookingForm(f => ({ ...f, startAt: e.target.value }))}
                                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                                    <label style={{ fontSize: 10, color: "var(--t3, #666)", fontFamily: "var(--font-body)" }}>End</label>
                                    <input
                                      type="datetime-local" value={bookingForm.endAt}
                                      onChange={e => setBookingForm(f => ({ ...f, endAt: e.target.value }))}
                                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }}
                                    />
                                  </div>
                                </div>
                                <button
                                  onClick={handleBookEquipment}
                                  disabled={bookingSaving}
                                  style={{ fontSize: 13, fontWeight: 700, background: "rgba(96,160,255,0.12)", border: "1px solid rgba(96,160,255,0.3)", color: "#60A0FF", padding: "8px 14px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: bookingSaving ? "not-allowed" : "pointer", alignSelf: "flex-start" }}
                                >
                                  {bookingSaving ? "Booking…" : "Book equipment"}
                                </button>
                              </div>

                              {/* Current bookings */}
                              {equipmentBookings.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--t3, #666)", fontFamily: "var(--font-body)", textTransform: "uppercase", marginBottom: 6 }}>Current bookings</div>
                                  {equipmentBookings.map(bk => (
                                    <div key={bk.booking_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                      <span style={{ fontSize: 13, color: "var(--t1)", fontFamily: "var(--font-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bk.equipment_name}</span>
                                      <span style={{ fontSize: 11, color: "var(--t3, #666)", fontFamily: "var(--font-body)", flexShrink: 0 }}>×{bk.qty}</span>
                                      <span style={{ fontSize: 11, color: "var(--t2)", fontFamily: "var(--font-body)", flexShrink: 0 }}>{bk.status}</span>
                                      {bk.status !== "cancelled" && (
                                        <button
                                          onClick={() => handleCancelEquipmentBooking(bk.booking_id)}
                                          style={{ fontSize: 11, background: "none", border: "1px solid var(--border)", color: "#FF6060", padding: "2px 8px", borderRadius: 10, fontFamily: "var(--font-body)", cursor: "pointer", flexShrink: 0 }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
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

      {/* ── Add Performance Event modal ──────────────────────────────────── */}
      {showAddEvent && tournamentDetail && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowAddEvent(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--b2)", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 540, padding: "24px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)" }}>Add Performance Event</div>

            {eventError && (
              <div style={{ fontSize: 13, color: "#FF6060", background: "rgba(255,96,96,0.08)", padding: "8px 12px", borderRadius: 8, fontFamily: "var(--font-body)" }}>{eventError}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Name</label>
              <input type="text" value={eventForm.name} onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. 100m Sprint" style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", width: "100%", boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Measurement</label>
                <select value={eventForm.measurementType} onChange={e => setEventForm(f => ({ ...f, measurementType: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none", appearance: "none" }}>
                  <option value="time_asc">Time (lower wins)</option>
                  <option value="time_desc">Time (higher wins)</option>
                  <option value="distance">Distance (further wins)</option>
                  <option value="height">Height (higher wins)</option>
                  <option value="weight">Weight (heavier wins)</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 90, flexShrink: 0 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Unit</label>
                <input type="text" value={eventForm.unit} onChange={e => setEventForm(f => ({ ...f, unit: e.target.value }))} placeholder="m, s, kg" style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Attempts</label>
                <input type="number" min="1" max="10" value={eventForm.attemptsPerAthlete} onChange={e => setEventForm(f => ({ ...f, attemptsPerAthlete: e.target.value }))} style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Category (opt)</label>
                <input type="text" value={eventForm.category} onChange={e => setEventForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. U12, Open" style={{ background: "var(--b3, rgba(255,255,255,0.06))", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)", outline: "none" }} />
              </div>
            </div>

            <button onClick={handleAddPerformanceEvent} disabled={eventSaving || !eventForm.name.trim()} style={{ marginTop: 4, background: eventSaving ? "rgba(255,255,255,0.1)" : "var(--amber)", color: eventSaving ? "var(--t2)" : "rgba(0,0,0,0.9)", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-body)", cursor: eventSaving ? "not-allowed" : "pointer", width: "100%" }}>
              {eventSaving ? "Adding…" : "Add Event"}
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
          clubVenues={clubVenuesForClub}
          loading={createLoading}
          onCreateSession={handleCreateSession}
          onCreateSeries={handleCreateSeries}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      <Tour tourKey="io_tour_club_sessions" enabled={clubToursEnabled()} />
      <ClubNavBar active="sessions" passToken={selectedClub?.pass_token} clubEntry={selectedClub} hasFeed={hasFeed} />
    </div>
  );
}

// ── SessionCard ───────────────────────────────────────────────────────────────
// Coach paid/unpaid roster (mig 398) — shown under "Message your team" for a
// team a manager runs. Read-only; reminders auto-send via the membership cron.
function fmtMoneyP(pence) {
  const p = Number(pence) || 0;
  return `£${(p / 100).toFixed(p % 100 === 0 ? 0 : 2)}`;
}
function payPill(color) {
  return { fontSize: 12, fontWeight: 700, fontFamily: "var(--font-body)", color,
    border: `1px solid ${color}`, borderRadius: 20, padding: "2px 10px", whiteSpace: "nowrap" };
}
function TeamPaymentsCard({ teamId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!teamId) return;
    let alive = true;
    setData(null); setErr(false);
    clubManagerTeamPayments(teamId)
      .then(r => { if (alive) setData(r?.members || []); })
      .catch(e => { if (alive) { console.error("[club-manager] team payments failed", e); setErr(true); } });
    return () => { alive = false; };
  }, [teamId]);

  if (err) return null;
  const members = data || [];
  const owingCount = members.filter(m => m.owes).length;

  return (
    <div style={{ marginTop: 12, background: "var(--b2)", border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--t2)", fontFamily: "var(--font-body)", textTransform: "uppercase" }}>Subs &amp; payments</span>
        {data && owingCount > 0 && <span style={{ fontSize: 12, color: "var(--red)", fontFamily: "var(--font-body)" }}>{owingCount} owing</span>}
      </div>
      <div style={{ padding: "6px 14px 12px" }}>
        <p style={{ fontSize: 12, color: "var(--t2)", fontFamily: "var(--font-body)", margin: "6px 0 4px", lineHeight: 1.4 }}>
          Who's paid and who owes — reminders go out automatically, so no chasing.
        </p>
        {!data && <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", margin: "8px 0 0" }}>Loading…</p>}
        {data && members.length === 0 && <p style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)", margin: "8px 0 0" }}>No members on this team yet.</p>}
        {data && members.map(m => (
          <div key={m.member_profile_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border-subtle)" }}>
            <span style={{ fontSize: 14, color: "var(--t1)", fontFamily: "var(--font-body)" }}>{m.name || "Member"}</span>
            {m.owes
              ? <span style={payPill("var(--red)")}>{m.overdue ? "Overdue" : "Owes"} {fmtMoneyP(m.amount_pence)}</span>
              : <span style={payPill("var(--green)")}>{m.membership_status === "active" ? "Paid" : "—"}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionCard({ session, onOpen }) {
  const typeStyle = TYPE_STYLE[session.session_type] ?? TYPE_STYLE.other;
  const rsvpState = RSVP_STYLE[session.own_rsvp_status] ?? null;

  return (
    <div
      data-tour="session-card"
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
      ) : (session.venue_name || session.location) ? (
        <div style={{ fontSize: 13, color: "var(--t2)", fontFamily: "var(--font-body)" }}>
          {[session.venue_name, session.location].filter(Boolean).join(" · ")}
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
          {session.venue_name && (
            <InfoRow label="Venue" value={session.venue_name} />
          )}
          {session.venue_address && (
            <InfoRow label="Address" value={session.venue_address} />
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
function CreateSessionModal({ managedTeams, clubVenues = [], loading, onCreateSession, onCreateSeries, onClose }) {
  const [mode, setMode]               = useState("oneoff"); // "oneoff" | "recurring"
  const [selectedTeamId, setSelectedTeamId] = useState(managedTeams[0]?.team_id ?? null);
  // Multi-venue (same-operator): anchor the session to one of the club's sites.
  // Defaults to the only venue when single-venue; picker shows when >1.
  const [venueId, setVenueId]         = useState(clubVenues.length === 1 ? clubVenues[0].venue_id : "");
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
        venueId: venueId || null,
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
        venueId: venueId || null,
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

          {/* Venue — shown when the club runs more than one site (same-operator) */}
          {clubVenues.length > 1 && (
            <div>
              <Label>Venue</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {clubVenues.map(v => {
                  const active = v.venue_id === venueId;
                  return (
                    <button key={v.venue_id} onClick={() => setVenueId(v.venue_id)} style={{
                      padding: "6px 14px", borderRadius: 20, cursor: "pointer",
                      border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                      background: active ? "var(--amber)" : "transparent",
                      color: active ? "rgba(0,0,0,0.9)" : "var(--t2)",
                      fontSize: 13, fontFamily: "var(--font-body)", fontWeight: active ? 700 : 400,
                    }}>
                      {v.venue_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
  // room for the fixed ClubNavBar (multi-context nav, Phase 1)
  paddingBottom: "calc(80px + env(safe-area-inset-bottom,0))",
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
