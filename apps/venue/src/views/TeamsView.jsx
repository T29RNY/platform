import React, { useEffect, useRef, useState } from "react";
import {
  venueListActiveTeams,
  venueListCustomers,
  venueListClubTeams,
  venueListPlayers,
} from "@platform/core/storage/supabase.js";
import TeamDetail from "./TeamDetail.jsx";
import CustomerDetailModal from "./CustomerDetailModal.jsx";
import { NudgeModal } from "./CustomersView.jsx";
import Icon from "./Icon.jsx";
import { TeamCrest, Crest } from "./atoms.jsx";
import { DataTable, TabbedPage } from "./PageKit.jsx";
import { relativeFrom, poundsRound, getInitials } from "../lib/format.js";

// Teams page (Venue People & Spaces IA, Phase 2). One page, three tabs —
// League teams (internal competition teams, full roster drill-down), Casual
// bookings (teams/walk-ins that book pitches — contact + booking history, no
// roster), Club teams (the membership-layer squads from the club org chart).
// A page-level player search sits above the tabs (league/competition players).
// All three tabs render through the shared DataTable primitive.

// ── Page wrapper: player search + tabbed table ───────────────────────────────
// `tabs` is the pre-filtered (flag + discipline) visible set from Dashboard;
// each carries { id, label, subhead, render }. `showPlayerSearch` reflects
// whether the League tab is visible (the player search covers competition players).
export default function TeamsPage({ venueToken, initialTab, tabs, showPlayerSearch }) {
  return (
    <div>
      {showPlayerSearch && <PlayerSearch venueToken={venueToken} />}
      <TabbedPage initial={initialTab} tabs={tabs} />
    </div>
  );
}

// ── League teams tab ─────────────────────────────────────────────────────────
export function LeagueTeamsTab({ venueToken }) {
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(null);
  const [openTeam, setOpenTeam] = useState(null);

  useEffect(() => {
    let alive = true;
    venueListActiveTeams(venueToken)
      .then((rows) => { if (alive) setTeams(Array.isArray(rows) ? rows : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  if (error) return <div className="dt-empty"><div className="dt-empty-title">Couldn’t load teams</div><div className="text-mute">{error}</div></div>;

  const columns = [
    { key: "name", label: "Team", sortable: true, render: (t) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <TeamCrest team={{ name: t.name, primary_colour: t.primary_colour, secondary_colour: t.secondary_colour }} size={30} />
        <span>{t.name}</span>
      </span>
    ) },
    { key: "type", label: "Type", render: () => <span className="dt-pill is-league">League</span> },
    { key: "competition_count", label: "Competitions", align: "num", sortable: true,
      render: (t) => t.competition_count ?? 0 },
    { key: "last_active_at", label: "Last active", sortable: true,
      sortValue: (t) => t.last_active_at || "",
      render: (t) => t.last_active_at ? relativeFrom(t.last_active_at) : "—" },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={teams}
        getRowKey={(t) => t.team_id}
        searchFields={["name"]}
        searchPlaceholder="Search teams…"
        onRowClick={(t) => setOpenTeam(t)}
        initialSort={{ key: "name", dir: "asc" }}
        empty={{ title: "No active teams yet", body: "Teams appear here once they’re approved into a competition." }}
        noMatch={{ title: "No teams match", body: "Try a different search." }}
      />
      {openTeam && (
        <TeamDetail venueToken={venueToken} teamId={openTeam.team_id} teamName={openTeam.name} onClose={() => setOpenTeam(null)} />
      )}
    </>
  );
}

// ── Casual bookings tab ──────────────────────────────────────────────────────
const NUDGE_STATUS = {
  new:     { label: "New",     cls: "pill-info" },
  healthy: { label: "Healthy", cls: "pill-ok" },
  lapsing: { label: "Lapsing", cls: "pill-warn" },
  dormant: { label: "Dormant", cls: "pill-muted" },
};

export function CasualTeamsTab({ venueToken }) {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [nudgeFor, setNudgeFor] = useState(null);

  useEffect(() => {
    let alive = true;
    venueListCustomers(venueToken)
      .then((res) => { if (alive) setCustomers(Array.isArray(res?.customers) ? res.customers : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  if (error) return <div className="dt-empty"><div className="dt-empty-title">Couldn’t load casual bookings</div><div className="text-mute">{error}</div></div>;

  const columns = [
    { key: "name", label: "Team / booker", sortable: true, render: (c) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        {c.is_team
          ? <Crest c1={c.primary_colour} c2={c.secondary_colour} size={30} initials={getInitials(c.name)} seed={c.name} />
          : <span className="cu-crest" style={{ width: 30, height: 30, background: "var(--bg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, fontSize: 11, color: "var(--ink-2)" }}>{getInitials(c.name)}</span>}
        <span>{c.name}</span>
      </span>
    ) },
    { key: "is_team", label: "Kind", render: (c) => <span className="dt-pill">{c.is_team ? "Team" : "Walk-in"}</span> },
    { key: "bookings_count", label: "Bookings", align: "num", sortable: true },
    { key: "total_paid_pence", label: "Collected", align: "num", sortable: true,
      render: (c) => poundsRound(c.total_paid_pence) },
    { key: "outstanding_pence", label: "Outstanding", align: "num", sortable: true,
      render: (c) => <span style={c.outstanding_pence > 0 ? { color: "var(--live)" } : null}>{poundsRound(c.outstanding_pence)}</span> },
    { key: "nudge_status", label: "Status", render: (c) => {
      const st = NUDGE_STATUS[c.nudge_status] || NUDGE_STATUS.healthy;
      return <span className={"pill " + st.cls}>{st.label}</span>;
    } },
    { key: "last_at", label: "Last active", sortable: true,
      sortValue: (c) => c.last_at || "",
      render: (c) => c.last_at ? relativeFrom(c.last_at) : "—" },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={customers}
        getRowKey={(c) => c.booker_key}
        searchFields={["name"]}
        searchPlaceholder="Search bookers…"
        filters={[
          { id: "teams", label: "Teams", test: (c) => c.is_team },
          { id: "walkins", label: "Walk-ins", test: (c) => !c.is_team },
        ]}
        onRowClick={(c) => setDetailFor(c)}
        initialSort={{ key: "last_at", dir: "desc" }}
        empty={{ title: "No casual bookings yet", body: "Bookers appear here once a team or walk-in books a pitch." }}
        noMatch={{ title: "No bookers match", body: "Try a different search or filter." }}
      />
      {detailFor && (
        <CustomerDetailModal customer={detailFor} venueToken={venueToken}
          onClose={() => setDetailFor(null)} onNudge={(c) => { setDetailFor(null); setNudgeFor(c); }} />
      )}
      {nudgeFor && <NudgeModal customer={nudgeFor} venueToken={venueToken} onClose={() => setNudgeFor(null)} />}
    </>
  );
}

// ── Club teams tab ───────────────────────────────────────────────────────────
const CATEGORY_BADGE = {
  youth: { label: "Youth", cls: "is-youth" },
  adult: { label: "Adult", cls: "is-adult" },
  mixed: { label: "Mixed", cls: "is-mixed" },
};

export function ClubTeamsTab({ venueToken }) {
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    venueListClubTeams(venueToken)
      .then((res) => { if (alive) setTeams(Array.isArray(res?.teams) ? res.teams : []); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  if (error) return <div className="dt-empty"><div className="dt-empty-title">Couldn’t load club teams</div><div className="text-mute">{error}</div></div>;

  const categoryFilters = [
    { id: "youth", label: "Youth", test: (t) => t.cohort_category === "youth" },
    { id: "adult", label: "Adult", test: (t) => t.cohort_category === "adult" },
    { id: "mixed", label: "Mixed", test: (t) => t.cohort_category === "mixed" },
  ];

  const columns = [
    { key: "name", label: "Team", sortable: true },
    { key: "club_name", label: "Club", sortable: true },
    { key: "cohort_name", label: "Age group", sortable: true, render: (t) => {
      const b = CATEGORY_BADGE[t.cohort_category];
      return <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {t.cohort_name}
        {b && <span className={"dt-pill cat " + b.cls}>{b.label}</span>}
      </span>;
    } },
    { key: "gender", label: "Gender", render: (t) => t.gender ? (t.gender[0].toUpperCase() + t.gender.slice(1)) : "—" },
    { key: "member_count", label: "Members", align: "num", sortable: true },
    { key: "priority_rank", label: "Priority", align: "num", sortable: true,
      sortValue: (t) => t.priority_rank ?? 9999,
      render: (t) => t.priority_rank ?? "—" },
    // Main contact lands in Phase 4 (settable, via the contact picker).
    { key: "main_contact", label: "Main contact", render: () => <span className="text-mute">—</span> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={teams}
      getRowKey={(t) => t.team_id}
      searchFn={(t, q) => (t.name || "").toLowerCase().includes(q) || (t.club_name || "").toLowerCase().includes(q) || (t.cohort_name || "").toLowerCase().includes(q)}
      searchPlaceholder="Search club teams…"
      filters={categoryFilters}
      initialSort={{ key: "club_name", dir: "asc" }}
      empty={{ title: "No club teams yet", body: "Club teams appear here once a club’s age groups and teams are set up under Memberships." }}
      noMatch={{ title: "No club teams match", body: "Try a different search or filter." }}
    />
  );
}

// ── Page-level player search (league / competition players) ──────────────────
function PlayerSearch({ venueToken }) {
  const [q, setQ] = useState("");
  const [players, setPlayers] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [openTeam, setOpenTeam] = useState(null);
  const loadingRef = useRef(false);

  // Lazy-load the player directory on first keystroke (avoids an RPC when the
  // operator only wants the team tabs).
  useEffect(() => {
    if (!q.trim() || loaded || loadingRef.current) return;
    loadingRef.current = true;
    venueListPlayers(venueToken)
      .then((res) => setPlayers(Array.isArray(res?.players) ? res.players : []))
      .catch(() => setPlayers([]))
      .finally(() => { setLoaded(true); });
  }, [q, loaded, venueToken]);

  const needle = q.trim().toLowerCase();
  const results = needle && players
    ? players.filter((p) =>
        (p.name || "").toLowerCase().includes(needle) ||
        (p.nickname || "").toLowerCase().includes(needle) ||
        (p.team_name || "").toLowerCase().includes(needle))
    : [];

  const columns = [
    { key: "shirt_number", label: "#", align: "num", width: 48, render: (p) => p.shirt_number ?? "–" },
    { key: "name", label: "Player", render: (p) => (
      <span>{p.name}{p.nickname && <span className="text-mute"> “{p.nickname}”</span>}</span>
    ) },
    { key: "team_name", label: "Team", render: (p) => (
      <span><span className="team-color-bar" style={{ "--c": p.team_colour || "var(--accent)" }} /> {p.team_name}</span>
    ) },
    { key: "goals", label: "G", align: "num", render: (p) => p.goals ?? 0 },
    { key: "motm", label: "P", align: "num", render: (p) => p.motm ?? 0 },
    { key: "attended", label: "App", align: "num", render: (p) => p.attended ?? 0 },
  ];

  return (
    <div className="player-search">
      <span className="search" style={{ maxWidth: 360 }}>
        <span className="ico"><Icon name="search" size={15} /></span>
        <input placeholder="Find a player across all your teams…" value={q} onChange={(e) => setQ(e.target.value)} />
      </span>
      {needle && (
        <div style={{ marginTop: 12 }}>
          {!loaded ? (
            <p className="text-mute" style={{ fontSize: 13 }}>Searching…</p>
          ) : (
            <DataTable
              columns={columns}
              rows={results}
              getRowKey={(p) => `${p.team_id}-${p.id}`}
              onRowClick={(p) => setOpenTeam({ team_id: p.team_id, name: p.team_name })}
              empty={{ title: "No players match", body: `Nothing matches “${q}”.` }}
            />
          )}
        </div>
      )}
      {openTeam && (
        <TeamDetail venueToken={venueToken} teamId={openTeam.team_id} teamName={openTeam.name} onClose={() => setOpenTeam(null)} />
      )}
    </div>
  );
}
