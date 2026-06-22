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
import DisplaySettings from "./DisplaySettings.jsx";
import TeamsView from "./TeamsView.jsx";
import StaffView from "./StaffView.jsx";
import LeagueView from "./LeagueView.jsx";
import LeagueTable from "./LeagueTable.jsx";
import PlayersView from "./PlayersView.jsx";
import CustomersView from "./CustomersView.jsx";
import MembershipsView, { FixturesTab } from "./MembershipsView.jsx";
import SessionsView from "./SessionsView.jsx";
import AccessView from "./AccessView.jsx";
import InvitesView from "./InvitesView.jsx";
import IntegrationsView from "./IntegrationsView.jsx";
import SearchPalette from "./SearchPalette.jsx";
import NotificationsPanel, { unseenCount } from "./NotificationsPanel.jsx";
import { poundsRound } from "../lib/format.js";

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
    { id: "ops",       label: "Operations", icon: "ops" },
    { id: "bookings",  label: "Bookings",   icon: "bookings", flag: "bookings" },
    { id: "payments",  label: "Payments",   icon: "payments" },
  ]},
  { group: "People", items: [
    { id: "customers",   label: "Customers",   icon: "customers" },
    { id: "memberships", label: "Memberships", icon: "pound", flag: "memberships" },
    { id: "teams",       label: "Teams",       icon: "teams" },
    { id: "players",     label: "Players",     icon: "players" },
    { id: "staff",       label: "Staff",       icon: "staff" },
  ]},
  { group: "Programmes", items: [
    { id: "sessions",  label: "Club sessions", icon: "staff",     flag: "coaching" },
    { id: "classes",   label: "Classes",   icon: "classes",   flag: "coaching" },
    { id: "trainers",  label: "Trainers",  icon: "staff",     flag: "coaching" },
    { id: "roomhire",  label: "Room hire", icon: "roomhire",  flag: "room_hire" },
    { id: "equipment", label: "Equipment", icon: "equipment", flag: "equipment" },
    { id: "spaces",    label: "Spaces",    icon: "spaces",    flag: "spaces" },
  ]},
  { group: "Competition", items: [
    { id: "fixtures", label: "Fixtures",  icon: "ops",   flag: "competition" },
    { id: "league",   label: "Leagues",   icon: "league", flag: "competition" },
    { id: "table",    label: "Standings", icon: "table",  flag: "competition" },
    { id: "cups",     label: "Cups",      icon: "cups", cupOnly: true, flag: "tournaments" },
  ]},
  { group: "Club & admin", items: [
    { id: "invites",      label: "QR codes",     icon: "settings" },
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

const TITLES = {
  ops: "Operations", bookings: "Bookings", payments: "Payments", equipment: "Equipment",
  customers: "Customers", memberships: "Memberships", sessions: "Club sessions", teams: "Teams", players: "Players", staff: "Staff",
  access: "Access", invites: "QR codes", spaces: "Spaces", classes: "Classes", trainers: "Trainers", roomhire: "Room hire", league: "Leagues", table: "Standings", cups: "Cups",
  fixtures: "Fixtures",
  integrations: "Integrations",
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

export default function Dashboard({ state, venueToken, occupancy = [], bookingIns = {}, features = null, me, onSignOut, onSwitchVenue, onRefresh, onRefreshOccupancy, refreshing, membershipTick = 0 }) {
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("connect") ? "integrations" : "ops";
  });

  // Deep-link / SearchPalette footgun guard: if the active view belongs to a
  // feature that's switched off, bounce to Operations. (Inert while every flag is
  // on; only fires once a feature is disabled in Phase 2.)
  useEffect(() => {
    const flag = VIEW_FLAG[view];
    if (flag && features && !featureOn(features, flag)) setView("ops");
  }, [view, features]);
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

  return (
    <div className="app">
      <Rail
        view={view} onView={setView}
        bookingBadge={pendingCount}
        features={features}
        hasCups={hasCups} showAccess={showAccess}
        anyLive={anyLive} liveCount={liveCount}
        onOpenWizard={() => setWizardOpen(true)}
        onOpenDisplay={() => setDisplayOpen(true)}
        me={me} onSignOut={onSignOut} onSwitchVenue={onSwitchVenue}
      />

      <div className="workspace">
        <Topbar
          view={view} onView={setView}
          state={state} pendingCount={pendingCount}
          liveCount={liveCount}
          onOpenWizard={() => setWizardOpen(true)}
          onRefresh={onRefresh} refreshing={refreshing}
        />

        <main className={"main" + (view === "ops" ? " with-sidebar" : "")}>
          {VIEW_FLAG[view] && features && !featureOn(features, VIEW_FLAG[view]) ? (
            <div className="text-mute" style={{ padding: 24 }}>This feature isn’t enabled for this venue.</div>
          ) : (<>
          {view === "ops" && (
            <>
              <div style={{ gridArea: "stats", minWidth: 0 }}>
                <OpsStatBar state={state} onView={setView} />
              </div>
              <div style={{ gridArea: "content", minWidth: 0 }}>
                <Operations state={state} venueToken={venueToken} onRefresh={onRefresh} />
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
          {view === "spaces" && <SpacesView venueToken={venueToken} />}
          {view === "classes" && <ClassesView venueToken={venueToken} />}
          {view === "trainers" && <TrainersView venueToken={venueToken} />}
          {view === "roomhire" && <RoomHiresView venueToken={venueToken} />}
          {view === "customers" && <CustomersView venueToken={venueToken} />}
          {view === "memberships" && <MembershipsView venueToken={venueToken} liveTick={membershipTick} pitches={state.pitches ?? []} refs={state.refs ?? []} />}
          {view === "sessions" && <SessionsView venueToken={venueToken} />}
          {view === "fixtures" && <FixturesTab venueToken={venueToken} pitches={state.pitches ?? []} refs={state.refs ?? []} />}
          {view === "teams" && <TeamsView venueToken={venueToken} />}
          {view === "players" && <PlayersView venueToken={venueToken} />}
          {view === "staff" && <StaffView state={state} venueToken={venueToken} onRefresh={onRefresh} />}
          {view === "access" && <AccessView venueToken={venueToken} me={me} />}
          {view === "invites" && <InvitesView state={state} venueToken={venueToken} />}
          {view === "league" && <LeagueView state={state} onNewSeason={() => setWizardOpen(true)} />}
          {view === "table" && <LeagueTable state={state} venueToken={venueToken} />}
          {view === "cups" && <BracketView state={state} venueToken={venueToken} onRefresh={onRefresh} />}
          {view === "integrations" && <IntegrationsView venueToken={venueToken} />}
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

function Rail({ view, onView, bookingBadge, features, hasCups, showAccess, anyLive, liveCount, onOpenWizard, onOpenDisplay, me, onSignOut, onSwitchVenue }) {
  return (
    <aside className="rail">
      <div className="rail-brand">
        <div className="mark">io</div>
        <div className="wm">In or Out<small>Venue console</small></div>
      </div>

      <nav className="rail-nav">
        {TABS.map((grp) => {
          const items = grp.items.filter((t) => (!t.cupOnly || hasCups) && (!t.adminOnly || showAccess) && featureOn(features, t.flag));
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

function Topbar({ view, onView, state, pendingCount, liveCount, onOpenWizard, onRefresh, refreshing }) {
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
