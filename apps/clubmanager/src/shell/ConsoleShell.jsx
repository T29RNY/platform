import React, { useMemo, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { themeVars, crestText } from "../lib/theme.js";
import { resolveHats, sectionsForHat } from "../lib/roles.js";
import Dashboard from "../views/Dashboard.jsx";
import Placeholder from "../views/Placeholder.jsx";

// Left-rail IA. Home is live in PR #1; the rest are themed placeholders that
// light up in later PRs. `key` gates against sectionsForHat() (nav → route →
// RPC three-layer gate).
const SECTIONS = [
  { key: "home",         path: "/",             label: "Home",         pr: null },
  { key: "people",       path: "/people",       label: "People",       pr: "PR #2" },
  { key: "structure",    path: "/structure",    label: "Structure",    pr: "PR #2" },
  { key: "schedule",     path: "/schedule",     label: "Schedule",     pr: "PR #3" },
  { key: "memberships",  path: "/memberships",  label: "Memberships",  pr: "PR #6" },
  { key: "matchday",     path: "/matchday",     label: "Matchday",     pr: "PR #8" },
  { key: "comms",        path: "/comms",        label: "Comms",        pr: "PR #5" },
  { key: "clubpage",     path: "/club-page",    label: "Club page",    pr: "PR #10" },
  { key: "safeguarding", path: "/safeguarding", label: "Safeguarding", pr: "PR #11" },
];

export default function ConsoleShell({
  club, branding, venues, selectedVenueId, onSelectVenue,
  clubs, selectedClubId, onSelectClub, world, email, onSignOut,
  venueId, clubId, clubPublic, clubLoading, clubError, onRetryClub,
}) {
  const hats = useMemo(() => resolveHats(world), [world]);
  const [activeHat, setActiveHat] = useState(null);
  const hatKey = activeHat || hats[0]?.key || "admin";
  const allowed = new Set(sectionsForHat(hatKey));
  const nav = SECTIONS.filter((s) => allowed.has(s.key));

  const clubName = club?.name || "Your club";
  const crestUrl = branding?.crest_url || null;

  return (
    <div className="console" style={themeVars(branding)}>
      <header className="topbar">
        <div className="brand">
          {crestUrl
            ? <img className="crest" src={crestUrl} alt="" style={{ objectFit: "cover" }} />
            : <span className="crest">{crestText(club)}</span>}
          <span>{clubName}</span>
          <span className="pill">Club Manager</span>
        </div>

        <div className="spacer" />

        <div className="user">
          {clubs && clubs.length > 1 && (
            <select value={selectedClubId || ""} onChange={(e) => onSelectClub(e.target.value)} aria-label="Club">
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {venues && venues.length > 1 && (
            <select value={selectedVenueId || ""} onChange={(e) => onSelectVenue(e.target.value)} aria-label="Ground">
              {venues.map((v) => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
            </select>
          )}
          {hats.length > 1 && (
            <select value={hatKey} onChange={(e) => setActiveHat(e.target.value)} aria-label="Role">
              {hats.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
          )}
          <span>{email}</span>
          <button className="small" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="shell">
        <nav className="rail">
          {nav.map((s) => (
            <NavLink key={s.key} to={s.path} end={s.path === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}>
              <span>{s.label}</span>
              {s.pr && <span className="rail-soon">soon</span>}
            </NavLink>
          ))}
        </nav>

        <main className="content">
          <Routes>
            <Route index element={
              <Dashboard
                venueId={venueId} clubId={clubId} clubName={clubName}
                clubPublic={clubPublic} clubLoading={clubLoading} clubError={clubError}
                onRetryClub={onRetryClub} world={world}
              />
            } />
            {SECTIONS.filter((s) => s.key !== "home").map((s) => (
              <Route key={s.key} path={s.path}
                element={<Placeholder title={s.label} pr={s.pr} />} />
            ))}
            <Route path="*" element={<Placeholder title="Not found" pr="Home" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
