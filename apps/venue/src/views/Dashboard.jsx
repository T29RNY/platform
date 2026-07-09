import React, { useState, useMemo, useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import Operations from "./Operations.jsx";
import Sidebar from "./Sidebar.jsx";
import SeasonWizard from "./SeasonWizard.jsx";
import BookingsView from "./BookingsView.jsx";
import PaymentsView from "./PaymentsView.jsx";
import EquipmentView from "./EquipmentView.jsx";
import SpacesView from "./SpacesView.jsx";
import ClassesView from "./ClassesView.jsx";
import TrainersView from "./TrainersView.jsx";
import RoomHiresView from "./RoomHiresView.jsx";
import BracketView from "./BracketView.jsx";
import TournamentsView from "./TournamentsView.jsx";
import DisplaySettings from "./DisplaySettings.jsx";
import TeamsPage, { LeagueTeamsTab, CasualTeamsTab, ClubTeamsTab } from "./TeamsView.jsx";
import StaffView from "./StaffView.jsx";
import LeagueView from "./LeagueView.jsx";
import LeagueTable from "./LeagueTable.jsx";
import MembershipsView, { FixturesTab } from "./MembershipsView.jsx";
import MembersPage from "./MembersView.jsx";
import SessionsView from "./SessionsView.jsx";
import AccessView from "./AccessView.jsx";
import InvitesView from "./InvitesView.jsx";
import IntegrationsView from "./IntegrationsView.jsx";
import SearchPalette from "./SearchPalette.jsx";
import NotificationsPanel, { unseenCount } from "./NotificationsPanel.jsx";
import FeaturesView from "./FeaturesView.jsx";
import SetupHub from "./SetupHub.jsx";
import ClubHome from "./ClubHome.jsx";
import { TabbedPage } from "./PageKit.jsx";
import { poundsRound } from "../lib/format.js";
import { itemDisciplineRelevant } from "../lib/featureRelevance.js";

// Rail IA (session 178, Phase 0): five groups — Run · People · Programmes ·
// Competition · Club & admin. Pure regroup/rename; ids are unchanged so deep
// links, SearchPalette and NotificationsPanel keep working. Fixtures surfaced
// here under Competition (was buried in Memberships).
// `flag` = the modular feature switch that gates this item (mig 399). Items with
// no flag are always-on core (Operations, Payments, People, QR, Access,
// Integrations). venue_features: bookings/spaces/room_hire/equipment. club_features:
// memberships/coaching/competition/tournaments. All default ON, so the rail is
// unchanged until a feature is switched off (Phase 2 operator UI).
const TABS = [
  { group: "Run", items: [
    { id: "setup",     label: "Set up venue", icon: "check" },
    { id: "ops",       label: "Operations", icon: "ops" },
    { id: "bookings",  label: "Bookings",   icon: "bookings", flag: "bookings" },
    { id: "payments",  label: "Payments",   icon: "payments" },
  ]},
  { group: "People", items: [
    // Members (Venue People & Spaces IA, Phase 3): a read-only directory page —
    // Members tab + a derived Guardians view. Operational membership management
    // (enrol / freeze / cancel / grading) stays on the Memberships screen until
    // the Phase 5 consistency sweep. Gated by the same `memberships` flag.
    { id: "members",     label: "Members",     icon: "customers", flag: "memberships" },
    { id: "memberships", label: "Memberships", icon: "pound", flag: "memberships" },
    // Teams is a combined page (Venue People & Spaces IA, Phase 2): three tabs —
    // League teams (competition roster), Casual bookings (pitch bookers) and Club
    // teams (membership layer). Players are folded in as a roster drill-down + a
    // page-level player search (no standalone Players item). Each sub keeps its own
    // flag + discipline rule: League stays competition-gated (football only), Casual
    // follows `bookings`, Club teams follow `memberships`.
    { id: "teams", label: "Teams", icon: "teams", subs: [
        { id: "teams",     flag: "competition" },  // League teams (discipline-gated)
        { id: "casual",    flag: "bookings" },     // Casual bookings
        { id: "clubteams", flag: "memberships" },  // Club teams
      ] },
    { id: "staff",       label: "Staff",       icon: "staff" },
  ]},
  { group: "Programmes", items: [
    // Combined pages (Venue People & Spaces IA, Phase 1): one rail item, related tabs.
    // `subs` carry the per-tab flag — the item shows when ANY sub is enabled; the page
    // renders only the enabled subs (collapsing the tab bar when one qualifies).
    { id: "timetable", label: "Timetable", icon: "classes", subs: [
        { id: "classes",  flag: "coaching" },   // Classes (discipline-gated to PT disciplines)
        { id: "sessions", flag: "coaching" },   // Team Training (RSVP; not discipline-gated)
      ] },
    { id: "trainers",  label: "Trainers",  icon: "staff",     flag: "coaching" },
    { id: "equipment", label: "Equipment", icon: "equipment", flag: "equipment" },
    { id: "rooms", label: "Rooms", icon: "spaces", subs: [
        { id: "spaces",   flag: "spaces" },     // Spaces (your rooms — config)
        { id: "roomhire", flag: "room_hire" },  // Room bookings (renting them out)
      ] },
  ]},
  { group: "Competition", items: [
    { id: "fixtures", label: "Club Leagues",   icon: "ops",   flag: "club_leagues" },
    { id: "league",   label: "Internal League", icon: "league", flag: "competition" },
    { id: "table",    label: "Standings",       icon: "table",  flag: "competition" },
    { id: "cups",     label: "Cups",      icon: "cups", cupOnly: true, flag: "tournaments" },
    // Event OS tournaments (Epic D). Standalone tournaments the operator creates &
    // runs from the console — distinct from the LEAGUE-mode `cups` item (BracketView)
    // above. NOT cupOnly: always reachable so a venue with zero tournaments can still
    // create the first one (the D2 chicken-and-egg fix).
    { id: "tournaments", label: "Tournaments", icon: "cups", flag: "tournaments" },
  ]},
  { group: "Club & admin", items: [
    { id: "invites",      label: "QR codes",     icon: "settings" },
    { id: "features",     label: "Features",     icon: "settings", facilityOnly: true },
    { id: "access",       label: "Access",       icon: "settings", adminOnly: true },
    { id: "integrations", label: "Integrations", icon: "settings" },
  ]},
];

// Map each gated view id → its feature flag, derived from TABS (single source of
// truth). Used by the route gate so a disabled feature can't be deep-linked.
const VIEW_FLAG = Object.fromEntries(
  TABS.flatMap((g) => g.items).filter((t) => t.flag).map((t) => [t.id, t.flag])
);

// Treat a missing flag set (still loading / lookup failed) as all-on so nothing
// ever flickers away; a known-false flag is the only thing that hides a surface.
function featureOn(features, flag) {
  if (!flag) return true;
  if (!features) return true;
  return features[flag] !== false;
}

// Combined-page support (Phase 1). A sub is visible when its flag is on AND it's relevant
// to the venue's disciplines (reusing the same two gates the rail applies to a normal item).
function subVisible(features, sub) {
  return featureOn(features, sub.flag) && itemDisciplineRelevant(features?.disciplines, sub.id);
}
// A nav item is visible when its own gates pass — or, for a combined item, when ANY sub passes.
function navItemVisible(t, features) {
  if (t.subs) return t.subs.some((s) => subVisible(features, s));
  return featureOn(features, t.flag) && itemDisciplineRelevant(features?.disciplines, t.id);
}
// Legacy view ids (deep-links / search) → [combined page id, tab to open].
const VIEW_ALIAS = {
  spaces:   ["rooms", "spaces"],
  roomhire: ["rooms", "roomhire"],
  classes:  ["timetable", "classes"],
  sessions: ["timetable", "sessions"],
  players:  ["teams", "teams"],   // legacy Players deep-link → Teams page, League tab
};

const TITLES = {
  ops: "Operations", bookings: "Bookings", payments: "Payments", equipment: "Equipment",
  members: "Members", memberships: "Memberships", sessions: "Team Training", teams: "Teams", staff: "Staff",
  access: "Access", invites: "QR codes", spaces: "Spaces", classes: "Classes", trainers: "Trainers", roomhire: "Room bookings", league: "Internal League", table: "Standings", cups: "Cups",
  rooms: "Rooms", timetable: "Timetable", tournaments: "Tournaments",
  fixtures: "Club Leagues",
  integrations: "Integrations",
  features: "Features",
  clubhome: "Club home",
};

// manage_logins capability for the signed-in caller (token backdoor = full owner).
function canManageLogins(me) {
  if (!me) return false;
  if (me.mode === "token") return true;
  if (me.role === "owner") return true;
  if ((me.capsDeny || []).includes("manage_logins")) return false;
  if ((me.capsGrant || []).includes("manage_logins")) return true;
  return me.role === "manager";
}

// manage_facility capability — gates the Features (modular toggle) screen, the
// same cap the server RPCs enforce. Token backdoor / owner = full.
function canManageFacility(me) {
  if (!me) return false;
  if (me.mode === "token") return true;
  if (me.role === "owner") return true;
  if ((me.capsDeny || []).includes("manage_facility")) return false;
  if ((me.capsGrant || []).includes("manage_facility")) return true;
  return me.role === "manager";
}

export default function Dashboard({ state, venueToken, occupancy = [], bookingIns = {}, features = null, me, onSignOut, onSwitchVenue, onRefresh, onRefreshOccupancy, onRefreshFeatures, refreshing, membershipTick = 0, clubs = [], clubContext = null, onSelectClub }) {
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("setup")) return "setup";
    return params.has("connect") ? "integrations" : "ops";
  });

  // Setup-hub auto-open (Decision #8, degrade by DERIVED state): a self-serve
  // venue arriving `pending` opens on the setup hub ONCE. A superadmin/`verified`
  // venue is never auto-routed here. Guarded so it fires at most once and never
  // fights the operator's own navigation. (verification_status is exposed by
  // mig 485; absent → treated as verified → no auto-open.)
  const autoRoutedRef = useRef(false);
  useEffect(() => {
    if (autoRoutedRef.current) return;
    if (state?.venue?.verification_status === "pending") {
      autoRoutedRef.current = true;
      const params = new URLSearchParams(window.location.search);
      if (!params.has("connect")) setView("setup");
    }
  }, [state?.venue?.verification_status]);

  // Session-level dismiss for the "finish setting up" reminder banner (a
  // persistent, cross-session dismissal store lands in PR-W3).
  const [setupReminderHidden, setSetupReminderHidden] = useState(false);

  // Deep-link / SearchPalette footgun guard: if the active view belongs to a
  // feature that's switched off, bounce to Operations. (Inert while every flag is
  // on; only fires once a feature is disabled in Phase 2.)
  useEffect(() => {
    const flag = VIEW_FLAG[view];
    if (flag && features && !featureOn(features, flag)) setView("ops");
  }, [view, features]);

  // Club lens (PR #1b): land on the club Home when a club is focused via the
  // topbar switcher, and return to Operations when the lens is cleared. The ref
  // starts null so arriving with a club already focused (?club seed) also lands
  // on Home. Only ever SETS view to "clubhome" when clubContext is truthy, so
  // the no-club render path stays byte-identical (PR #1 invariant). The clear
  // branch uses a functional setView so it reads the live view without a dep.
  const prevClubRef = useRef(null);
  useEffect(() => {
    const prev = prevClubRef.current;
    prevClubRef.current = clubContext;
    if (clubContext && clubContext !== prev) setView("clubhome");
    else if (!clubContext && prev) setView((v) => (v === "clubhome" ? "ops" : v));
  }, [clubContext]);
  // Combined-page normalization: a legacy view id (deep-link / search) resolves to its
  // combined page + the tab to open. Non-aliased views pass straight through.
  const [pageView, initialTab] = VIEW_ALIAS[view] || [view, undefined];
  const [wizardOpen, setWizardOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  const hasCups = useMemo(
    () => (state.competitions ?? []).some((c) => c.type === "cup"),
    [state.competitions]
  );

  // Pending-booking count for the Bookings badge — collapse a weekly block
  // (shared series_id) into one item.
  const pendingCount = useMemo(() => {
    const singles = new Set();
    const series = new Set();
    for (const o of occupancy) {
      if (o.source_kind !== "booking" || o.detail?.status !== "requested") continue;
      if (o.detail.series_id) series.add(o.detail.series_id);
      else singles.add(o.source_id);
    }
    return singles.size + series.size;
  }, [occupancy]);

  const tonight = state.fixtures?.tonight ?? [];
  const liveCount = tonight.filter((f) => f.status === "in_progress").length;
  const anyLive = liveCount > 0;
  const showAccess = canManageLogins(me);
  const showFeatures = canManageFacility(me);

  // Combined-page tab sets (Phase 1). Each sub carries its own plain-English subhead;
  // only the flag-enabled + discipline-relevant subs are passed to TabbedPage.
  const COMBINED = {
    teams: [
      { id: "teams", label: "League teams", flag: "competition",
        subhead: "Your internal competition teams. Open one for the full roster; use the search above to find any player.",
        render: () => <LeagueTeamsTab venueToken={venueToken} /> },
      { id: "casual", label: "Casual bookings", flag: "bookings",
        subhead: "Teams and walk-ins who book your pitches — contact, bookings and what they’ve paid. (Casual squads have no roster here.)",
        render: () => <CasualTeamsTab venueToken={venueToken} /> },
      { id: "clubteams", label: "Club teams", flag: "memberships",
        subhead: "Your club’s membership teams by age group — the squads set up under Memberships.",
        render: () => <ClubTeamsTab venueToken={venueToken} /> },
    ],
    rooms: [
      { id: "spaces", label: "Spaces", flag: "spaces",
        subhead: "Your bookable rooms and areas. Set them up once — classes and room bookings schedule into them.",
        render: () => <SpacesView venueToken={venueToken} /> },
      { id: "roomhire", label: "Room bookings", flag: "room_hire",
        subhead: "When someone hires one of your spaces: requests to confirm or decline, plus confirmed bookings and deposits.",
        render: () => <RoomHiresView venueToken={venueToken} /> },
    ],
    timetable: [
      { id: "classes", label: "Classes", flag: "coaching",
        subhead: "Scheduled classes members book a place on — capacity, waitlist and check-in.",
        render: () => <ClassesView venueToken={venueToken} /> },
      { id: "sessions", label: "Team Training", flag: "coaching",
        subhead: "Your teams' training sessions — players RSVP in or out, like the matchday flow.",
        render: () => <SessionsView venueToken={venueToken} clubContext={clubContext} /> },
    ],
  };
  const combinedSubs = COMBINED[pageView] || null;
  const visibleSubs = combinedSubs ? combinedSubs.filter((s) => subVisible(features, s)) : null;
  const blocked = combinedSubs
    ? (!!features && visibleSubs.length === 0)
    : (VIEW_FLAG[pageView] && features && !featureOn(features, VIEW_FLAG[pageView]));

  return (
    <div className="app">
      <Rail
        view={pageView} onView={setView}
        bookingBadge={pendingCount}
        features={features}
        hasCups={hasCups} showAccess={showAccess} showFeatures={showFeatures}
        anyLive={anyLive} liveCount={liveCount}
        onOpenWizard={() => setWizardOpen(true)}
        onOpenDisplay={() => setDisplayOpen(true)}
        me={me} onSignOut={onSignOut} onSwitchVenue={onSwitchVenue}
      />

      <div className="workspace">
        <Topbar
          view={pageView} onView={setView}
          state={state} pendingCount={pendingCount}
          liveCount={liveCount}
          onOpenWizard={() => setWizardOpen(true)}
          onRefresh={onRefresh} refreshing={refreshing}
          clubs={clubs} clubContext={clubContext} onSelectClub={onSelectClub}
        />

        <main className={"main" + (pageView === "ops" ? " with-sidebar" : "")}>
          {view !== "setup" && !setupReminderHidden && state?.venue?.verification_status === "pending" && (
            <div className="setup-reminder" role="status">
              <span className="setup-reminder-ico"><Icon name="alert" size={16} /></span>
              <span className="setup-reminder-copy">Finish setting up your venue to go live.</span>
              <button className="btn btn-primary btn-sm" onClick={() => setView("setup")}>Continue setup</button>
              <button className="setup-reminder-x" aria-label="Dismiss" onClick={() => setSetupReminderHidden(true)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {blocked ? (
            <div className="text-mute" style={{ padding: 24 }}>This feature isn’t enabled for this venue.</div>
          ) : (<>
          {view === "setup" && (
            <SetupHub
              state={state}
              venueToken={venueToken}
              features={features}
              onView={setView}
              onRefresh={onRefresh}
              onRefreshFeatures={onRefreshFeatures}
            />
          )}
          {view === "clubhome" && (
            <ClubHome
              venueToken={venueToken}
              clubId={clubContext}
              clubName={clubs.find((c) => c.id === clubContext)?.name}
            />
          )}
          {view === "ops" && (
            <>
              <div style={{ gridArea: "stats", minWidth: 0 }}>
                <OpsStatBar state={state} onView={setView} />
              </div>
              <div style={{ gridArea: "content", minWidth: 0 }}>
                <Operations state={state} venueToken={venueToken} onRefresh={onRefresh} me={me} />
              </div>
              <div style={{ gridArea: "sidebar", minWidth: 0 }}>
                <Sidebar pitches={state.pitches ?? []} refs={state.refs ?? []} venueToken={venueToken} onDone={onRefresh} />
              </div>
            </>
          )}

          {view === "bookings" && (
            <BookingsView state={state} venueToken={venueToken} occupancy={occupancy} bookingIns={bookingIns} onRefresh={onRefresh} onRefreshOccupancy={onRefreshOccupancy} />
          )}
          {view === "payments" && <PaymentsView state={state} venueToken={venueToken} />}
          {view === "equipment" && <EquipmentView venueToken={venueToken} state={state} />}
          {pageView === "rooms" && (
            <TabbedPage initial={initialTab}
              tabs={(visibleSubs || []).map((s) => ({ id: s.id, label: s.label, subhead: s.subhead, render: s.render }))} />
          )}
          {pageView === "timetable" && (
            <TabbedPage initial={initialTab}
              tabs={(visibleSubs || []).map((s) => ({ id: s.id, label: s.label, subhead: s.subhead, render: s.render }))} />
          )}
          {view === "trainers" && <TrainersView venueToken={venueToken} />}
          {view === "members" && <MembersPage venueToken={venueToken} />}
          {view === "memberships" && <MembershipsView venueToken={venueToken} liveTick={membershipTick} pitches={state.pitches ?? []} refs={state.refs ?? []} />}
          {view === "fixtures" && <FixturesTab venueToken={venueToken} pitches={state.pitches ?? []} refs={state.refs ?? []} />}
          {pageView === "teams" && (
            <TeamsPage
              venueToken={venueToken}
              initialTab={initialTab}
              showPlayerSearch={(visibleSubs || []).some((s) => s.id === "teams")}
              tabs={(visibleSubs || []).map((s) => ({ id: s.id, label: s.label, subhead: s.subhead, render: s.render }))}
            />
          )}
          {view === "staff" && <StaffView state={state} venueToken={venueToken} onRefresh={onRefresh} />}
          {view === "access" && <AccessView venueToken={venueToken} me={me} />}
          {view === "invites" && <InvitesView state={state} venueToken={venueToken} />}
          {view === "league" && <LeagueView state={state} onNewSeason={() => setWizardOpen(true)} />}
          {view === "table" && <LeagueTable state={state} venueToken={venueToken} />}
          {view === "cups" && <BracketView state={state} venueToken={venueToken} onRefresh={onRefresh} />}
          {view === "tournaments" && <TournamentsView venueToken={venueToken} />}
          {view === "integrations" && <IntegrationsView venueToken={venueToken} />}
          {view === "features" && <FeaturesView venueToken={venueToken} features={features} onChanged={onRefreshFeatures} />}
          </>)}
        </main>
      </div>

      <DisplaySettings
        open={displayOpen}
        onClose={() => setDisplayOpen(false)}
        venueToken={venueToken}
        venue={state.venue ?? {}}
        fixtures={tonight}
        teams={state.teams ?? {}}
        onSaved={onRefresh}
      />
      {wizardOpen && (
        <SeasonWizard state={state} venueToken={venueToken} onClose={() => setWizardOpen(false)} onDone={onRefresh} />
      )}
    </div>
  );
}

function Rail({ view, onView, bookingBadge, features, hasCups, showAccess, showFeatures, anyLive, liveCount, onOpenWizard, onOpenDisplay, me, onSignOut, onSwitchVenue }) {
  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="mark">io</div>
        <div className="wm">In or Out<small>Venue console</small></div>
      </div>

      <nav className="rail-nav">
        {TABS.map((grp) => {
          // Two orthogonal rail gates: featureOn = purchased flag (mig 399/400),
          // itemDisciplineRelevant = relevance to the venue's club disciplines (C).
          // An item shows only when BOTH pass (plus its data/role conditions).
          const items = grp.items.filter((t) =>
            (!t.cupOnly || hasCups) &&
            (!t.adminOnly || showAccess) &&
            (!t.facilityOnly || showFeatures) &&
            navItemVisible(t, features));
          if (items.length === 0) return null;   // hide a group whose every item is gated off
          return (
            <React.Fragment key={grp.group}>
              <div className="rail-nav-label">{grp.group}</div>
              {items.map((t) => (
                <button
                  key={t.id}
                  className="rail-tab"
                  aria-current={view === t.id ? "page" : undefined}
                  onClick={() => onView(t.id)}
                >
                  <span className="ico"><Icon name={t.icon} /></span>
                  <span>{t.label}</span>
                  {t.id === "bookings" && bookingBadge > 0 && <span className="badge">{bookingBadge}</span>}
                </button>
              ))}
            </React.Fragment>
          );
        })}
      </nav>

      <div className="rail-footer">
        <div className={"rail-status " + (anyLive ? "live" : "standby")}>
          <span className="dot" />
          <div style={{ minWidth: 0 }}>
            <div className="lbl">Status</div>
            <div className="val">{anyLive ? `On Air · ${liveCount} live` : "Standby"}</div>
          </div>
        </div>
        <button className="rail-tab" onClick={onOpenDisplay}>
          <span className="ico"><Icon name="tv" /></span><span>Reception display</span>
        </button>
        <button className="rail-tab" onClick={onOpenWizard}>
          <span className="ico"><Icon name="settings" /></span><span>Season setup</span>
        </button>

        {me?.mode === "login" && (
          <div className="rail-account">
            <div className="who">
              <div className="email" title={me.email}>{me.email}</div>
              <div className="role">{me.role}</div>
            </div>
            {onSwitchVenue && (
              <button className="rail-tab" onClick={onSwitchVenue}>
                <span className="ico"><Icon name="arrow_r" /></span><span>Switch venue</span>
              </button>
            )}
            <button className="rail-tab" onClick={onSignOut}>
              <span className="ico"><Icon name="x" /></span><span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Topbar({ view, onView, state, pendingCount, liveCount, onOpenWizard, onRefresh, refreshing, clubs = [], clubContext = null, onSelectClub }) {
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setShowSearch(true); }
      if (e.key === "Escape") { setShowSearch(false); setShowNotifs(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tonight = state.fixtures?.tonight ?? [];
  const needsAssign = tonight.filter((f) => !f.playing_area_id || !f.official_id).length;
  const notifCount = unseenCount(state, pendingCount);

  const bits = [];
  if (view === "ops") {
    if (liveCount > 0) bits.push({ tone: "live", label: `${liveCount} live now` });
    if (needsAssign > 0) bits.push({ tone: "warn", label: `${needsAssign} to assign` });
    if (liveCount === 0 && tonight.length > 0) bits.push({ tone: "mute", label: `${tonight.length} kicking off tonight` });
  } else if (view === "bookings" && pendingCount > 0) {
    bits.push({ tone: "warn", label: `${pendingCount} request${pendingCount === 1 ? "" : "s"} pending` });
  } else if (view === "table") {
    bits.push({ tone: "live", label: "Updates live" });
  }

  const action = view === "league" ? { label: "New season", icon: "plus", onClick: onOpenWizard } : null;

  return (
    <header className="topbar">
      <div className="tb-title-block">
        <h1 className="tb-title">{TITLES[view]}</h1>
        {bits.length > 0 && (
          <div className="tb-bits">
            {bits.map((b, i) => (
              <span key={i} className={"tb-bit tb-bit-" + b.tone}><span className="tb-dot" /> {b.label}</span>
            ))}
          </div>
        )}
      </div>

      {clubs.length > 0 && onSelectClub && (
        <select
          className="tb-club-lens"
          aria-label="Club lens — focus the console on one club"
          title="Focus the console on one club"
          value={clubContext || ""}
          onChange={(e) => onSelectClub(e.target.value || null)}
          style={{
            background: "transparent",
            color: "var(--ink)",
            border: "1px solid " + (clubContext ? "var(--accent)" : "var(--border)"),
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            fontSize: 13,
            fontFamily: "var(--font-sans)",
            maxWidth: 220,
            cursor: "pointer",
          }}
        >
          <option value="">All clubs · venue view</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      <button className="btn btn-icon btn-sm" aria-label="Search" title="Search (⌘K)" onClick={() => setShowSearch(true)}>
        <Icon name="search" size={16} />
      </button>
      <div style={{ position: "relative" }}>
        <button ref={bellRef} className="btn btn-icon btn-sm" aria-label="Notifications" onClick={(e) => { e.stopPropagation(); setShowNotifs((s) => !s); }}>
          <Icon name="bell" size={16} />
          {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
        </button>
        {showNotifs && (
          <NotificationsPanel
            state={state} pendingBookings={pendingCount}
            anchorRect={bellRef.current?.getBoundingClientRect()}
            onClose={() => setShowNotifs(false)}
            onNavigate={(r) => r.tab && onView(r.tab)}
          />
        )}
      </div>
      <button className="btn btn-icon btn-sm" aria-label="Refresh" title="Refresh" onClick={onRefresh} disabled={refreshing}>
        <Icon name="refresh" size={16} />
      </button>

      <LiveClock />

      {action && (
        <button className="btn btn-sm btn-primary" onClick={action.onClick}>
          <Icon name={action.icon} size={14} /> {action.label}
        </button>
      )}

      {showSearch && (
        <SearchPalette state={state} onClose={() => setShowSearch(false)} onNavigate={(r) => { if (r.tab) onView(r.tab); }} />
      )}
    </header>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="clock">
      <span className="time">{h}<span className="colon">:</span>{m}</span>
      <span className="date">{date}</span>
    </div>
  );
}

function OpsStatBar({ state, onView }) {
  const tonight = state.fixtures?.tonight ?? [];
  const live = tonight.filter((f) => f.status === "in_progress").length;
  const needsAssign = tonight.filter((f) => !f.playing_area_id || !f.official_id).length;
  const pendingReg = (state.pending_registrations ?? []).length;
  const incidents = (state.open_incidents ?? []).length;
  const outstanding = state.payments_summary?.outstanding_pence ?? null;

  const scrollTo = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };

  return (
    <div className="stat-row">
      <Stat ico="ops" label="Tonight" value={tonight.length}
        sub={live > 0 ? <><span className="delta up">{live} live</span> right now</> : <>kicking off</>}
        onClick={() => scrollTo(".tonight")} />
      <Stat ico="alert" label="To assign" value={needsAssign}
        sub={needsAssign > 0 ? <>pitch or ref missing</> : <>all set</>}
        tone={needsAssign > 0 ? "crit" : ""}
        onClick={() => scrollTo(".tonight")} />
      <Stat ico="info" label="Issues" value={pendingReg + incidents}
        sub={<>{pendingReg} regs, {incidents} incidents</>}
        tone={pendingReg + incidents > 0 ? "accent" : ""}
        onClick={() => scrollTo(".issues")} />
      <Stat ico="pound" label="Outstanding" value={outstanding != null ? poundsRound(outstanding) : "—"}
        sub={<>see Payments</>}
        onClick={() => onView("payments")} />
    </div>
  );
}

function Stat({ ico, label, value, sub, tone, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={"stat" + (tone ? " stat--" + tone : "")} onClick={onClick} type={onClick ? "button" : undefined}>
      <div className="stat-head">
        <span className="stat-ico"><Icon name={ico} size={15} /></span>
        <span>{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
      {onClick && <span className="stat-arrow" aria-hidden="true"><Icon name="arrow_r" size={14} /></span>}
    </Tag>
  );
}
