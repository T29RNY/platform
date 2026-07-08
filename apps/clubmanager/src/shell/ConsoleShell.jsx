import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { getVenueFeatureFlags } from "@platform/core/storage/supabase.js";
import { themeVars, crestText } from "../lib/theme.js";
import { resolveHats, sectionsForHat } from "../lib/roles.js";
import { ToastProvider } from "./toast.jsx";
import Dashboard from "../views/Dashboard.jsx";
import Structure from "../views/Structure.jsx";
import People from "../views/People.jsx";
import Schedule from "../views/Schedule.jsx";
import Comms from "../views/Comms.jsx";
import Memberships from "../views/Memberships.jsx";
import ClubPage from "../views/ClubPage.jsx";
import Safeguarding from "../views/Safeguarding.jsx";
import Placeholder from "../views/Placeholder.jsx";

// Left-rail IA. `live` sections are wired now; the rest are themed placeholders
// that light up in later PRs. Three-layer gate: nav (sectionsForHat + `flag`) →
// route → RPC (server re-enforces). `flag` hides a section when the club's
// feature flag is explicitly OFF (fail-open: shown on read error).
const SECTIONS = [
  { key: "home",         path: "/",             label: "Home",         live: true },
  { key: "people",       path: "/people",       label: "People",       live: true },
  { key: "structure",    path: "/structure",    label: "Structure",    live: true },
  { key: "schedule",     path: "/schedule",     label: "Schedule",     live: true },
  { key: "memberships",  path: "/memberships",  label: "Memberships",  live: true, flag: "memberships" },
  { key: "matchday",     path: "/matchday",     label: "Matchday",     pr: "PR #8", flag: "competition" },
  { key: "comms",        path: "/comms",        label: "Comms",        live: true },
  { key: "clubpage",     path: "/club-page",    label: "Club page",    live: true },
  { key: "safeguarding", path: "/safeguarding", label: "Safeguarding", live: true },
];

export default function ConsoleShell({
  club, branding, venues, selectedVenueId, onSelectVenue,
  clubs, selectedClubId, onSelectClub, world, email, onSignOut,
  venueId, clubId, clubPublic, clubLoading, clubError, onRetryClub,
}) {
  const hats = useMemo(() => resolveHats(world), [world]);
  const [activeHat, setActiveHat] = useState(null);
  const hatKey = activeHat || hats[0]?.key || "admin";

  // Feature flags (nav+route layer of the three-layer gate). Fail-open.
  const [flags, setFlags] = useState(null);
  useEffect(() => {
    setFlags(null);                       // reset on venue switch so nav doesn't show the old venue's flags
    if (!venueId) return;
    let cancelled = false;
    getVenueFeatureFlags(venueId)
      .then((f) => { if (!cancelled) setFlags(f); })
      .catch((err) => { console.error("[clubmanager] feature flags failed", err); if (!cancelled) setFlags(null); });
    return () => { cancelled = true; };
  }, [venueId]);

  const allowed = new Set(sectionsForHat(hatKey));
  const nav = SECTIONS.filter((s) => allowed.has(s.key))
    .filter((s) => !s.flag || !flags || flags[s.flag] !== false);

  const clubName = club?.name || "Your club";
  const crestUrl = branding?.crest_url || null;

  return (
    <ToastProvider>
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
                {!s.live && <span className="rail-soon">soon</span>}
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
              <Route path="/structure" element={<Structure venueId={venueId} clubId={clubId} />} />
              <Route path="/people" element={<People venueId={venueId} clubId={clubId} />} />
              <Route path="/schedule" element={<Schedule venueId={venueId} clubId={clubId} />} />
              <Route path="/comms" element={<Comms venueId={venueId} clubId={clubId} />} />
              <Route path="/memberships" element={<Memberships venueId={venueId} />} />
              <Route path="/club-page" element={<ClubPage venueId={venueId} clubId={clubId} />} />
              <Route path="/safeguarding" element={<Safeguarding venueId={venueId} clubId={clubId} />} />
              {SECTIONS.filter((s) => !s.live).map((s) => (
                <Route key={s.key} path={s.path}
                  element={<Placeholder title={s.label} pr={s.pr} />} />
              ))}
              <Route path="*" element={<Placeholder title="Not found" pr="Home" />} />
            </Routes>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
