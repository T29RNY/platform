import React, { useCallback, useEffect, useState } from "react";
import {
  venueListClubStaff, venueListClubLeagues, venueListClubFixtures,
  venueMembershipSummary,
} from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";
import Icon from "./Icon.jsx";

// Club-first Home dashboard for the venue console's club lens (Club Console
// Consolidation PR #1b). Renders when a club is focused via the topbar switcher.
// Composed CLIENT-SIDE from EXISTING venue-token reads — no roll-up RPC — so it
// stays tier-1. Three glances: DBS compliance, fixtures this week, membership.
//
// Multi-venue note: every reader resolves to the CURRENT venue and gates on it,
// so this is "this venue's view of the club" — a club's leagues/staff attached
// to a sibling venue of the same operator are not aggregated here (consistent
// with PR #1: clubContext is a narrowing filter, selectedVenueId is the
// credential). Copy is kept honest about that where it matters.

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WARN_DAYS = 60;

// DBS red/amber/green for one coach row (matches the retired clubmanager tile).
function classifyDbs(row, now) {
  if (!row.dbs_id || !row.dbs_status) return "danger";          // no check on file
  const s = String(row.dbs_status).toLowerCase();
  if (s !== "valid" && s !== "verified" && s !== "clear") return "danger";
  if (row.dbs_expiry_date) {
    const exp = new Date(row.dbs_expiry_date + "T00:00:00");
    if (!isNaN(exp.getTime())) {
      const days = (exp.getTime() - now.getTime()) / 86400000;
      if (days < 0) return "danger";
      if (days <= WARN_DAYS) return "warn";
    }
  }
  return "good";
}

function fmtGbp(pence) {
  const p = Number(pence) || 0;
  const pounds = p / 100;
  return "£" + (pounds % 1 === 0 ? pounds.toFixed(0) : pounds.toFixed(2));
}

// A small labelled stat card matching venue's Operations glances (.stat). When
// onClick is passed it renders as a button.stat (venue's clickable-glance style,
// with the hover .stat-arrow) so a tile drills down into its underlying section.
function StatCard({ label, value, sub, tone, onClick }) {
  const cls = "stat" + (tone ? ` stat--${tone}` : "");
  const body = (
    <>
      <div className="stat-head"><span>{label}</span></div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        <span className="stat-arrow"><Icon name="arrow_r" size={14} /></span>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

// A detail list row (venue has no table atom — flex rows with token borders).
function DetailRow({ left, right, tone }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 12,
      alignItems: "center", padding: "10px 0",
      borderBottom: "1px solid var(--border)", fontSize: 13,
    }}>
      <span style={{ color: tone === "danger" ? "var(--live)" : tone === "warn" ? "var(--warn)" : "var(--ink)" }}>{left}</span>
      <span style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}

export default function ClubHome({ venueToken, clubId, clubName, onView }) {
  // Drill-down target per glance (only when a nav handler is provided). Loading/
  // error tiles stay non-clickable (the error tile owns a retry button — a button
  // inside a button would be invalid).
  const goStaff = onView ? () => onView("staff") : undefined;
  const goFixtures = onView ? () => onView("fixtures") : undefined;
  const goMemberships = onView ? () => onView("memberships") : undefined;
  // ── Compliance (DBS) ──
  const [dbs, setDbs] = useState({ loading: true, error: false, staff: [] });
  const loadDbs = useCallback(async () => {
    if (!venueToken || !clubId) { setDbs({ loading: false, error: false, staff: [] }); return; }
    setDbs((s) => ({ ...s, loading: true, error: false }));
    try {
      const staff = await venueListClubStaff(venueToken, clubId);
      setDbs({ loading: false, error: false, staff: Array.isArray(staff) ? staff : [] });
    } catch { setDbs({ loading: false, error: true, staff: [] }); }
  }, [venueToken, clubId]);

  // ── This week (leagues → fixtures, next 7 days) ──
  const [fx, setFx] = useState({ loading: true, error: false, fixtures: [] });
  const loadFixtures = useCallback(async () => {
    if (!venueToken || !clubId) { setFx({ loading: false, error: false, fixtures: [] }); return; }
    setFx((s) => ({ ...s, loading: true, error: false }));
    try {
      const lRes = await venueListClubLeagues(venueToken, clubId);
      const leagues = lRes?.leagues ?? (Array.isArray(lRes) ? lRes : []);
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start.getTime() + 7 * 86400000);
      const all = [];
      for (const lg of leagues) {
        const fRes = await venueListClubFixtures(venueToken, lg.league_id);
        const fixtures = fRes?.fixtures ?? (Array.isArray(fRes) ? fRes : []);
        for (const f of fixtures) {
          if (f.status !== "scheduled" || !f.scheduled_date) continue;
          const d = new Date(f.scheduled_date + "T" + (f.kickoff_time || "00:00") + ":00");
          if (isNaN(d.getTime()) || d < start || d > end) continue;
          all.push({ ...f, when: d });
        }
      }
      all.sort((a, b) => a.when - b.when);
      setFx({ loading: false, error: false, fixtures: all });
    } catch { setFx({ loading: false, error: true, fixtures: [] }); }
  }, [venueToken, clubId]);

  // ── Membership (venue-wide glance — honestly labelled, not club-scoped) ──
  const [mem, setMem] = useState({ loading: true, error: false, summary: null });
  const loadMembership = useCallback(async () => {
    if (!venueToken) { setMem({ loading: false, error: false, summary: null }); return; }
    setMem((s) => ({ ...s, loading: true, error: false }));
    try {
      const summary = await venueMembershipSummary(venueToken);
      setMem({ loading: false, error: false, summary: summary || {} });
    } catch { setMem({ loading: false, error: true, summary: null }); }
  }, [venueToken]);

  useEffect(() => { loadDbs(); }, [loadDbs]);
  useEffect(() => { loadFixtures(); }, [loadFixtures]);
  useEffect(() => { loadMembership(); }, [loadMembership]);

  // ── Derive compliance glance ──
  const now = new Date();
  const activeStaff = dbs.staff.filter((s) => s.is_active !== false);
  const issues = [];
  let goodCount = 0;
  activeStaff.forEach((row) => {
    const c = classifyDbs(row, now);
    if (c === "good") { goodCount += 1; return; }
    issues.push({
      name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Coach",
      team: row.team_name || "",
      level: c,
      reason: !row.dbs_id ? "No DBS on file" : c === "danger" ? "Expired / not valid" : "Expiring soon",
    });
  });
  const dbsClear = issues.length === 0;

  const mm = mem.summary || {};

  return (
    <div>
      <SectionHead label={clubName ? `${clubName} · Club home` : "Club home"} />

      {/* Top glances */}
      <div className="stat-row">
        {/* Compliance */}
        {dbs.loading ? (
          <StatCard label="DBS compliance" value="…" sub="Checking clearances" />
        ) : dbs.error ? (
          <StatCard label="DBS compliance" value="—" sub={<button className="btn btn-ghost btn-xs" onClick={loadDbs}>Try again</button>} tone="crit" />
        ) : activeStaff.length === 0 ? (
          <StatCard label="DBS compliance" value="0" sub="No coaches on the books yet" onClick={goStaff} />
        ) : dbsClear ? (
          <StatCard label="DBS compliance" value={goodCount} sub="all coaches cleared" tone="ok" onClick={goStaff} />
        ) : (
          <StatCard label="DBS compliance" value={issues.length} sub={`of ${activeStaff.length} coaches need attention`} tone="crit" onClick={goStaff} />
        )}

        {/* This week */}
        {fx.loading ? (
          <StatCard label="This week" value="…" sub="Loading fixtures" />
        ) : fx.error ? (
          <StatCard label="This week" value="—" sub={<button className="btn btn-ghost btn-xs" onClick={loadFixtures}>Try again</button>} tone="crit" />
        ) : (
          <StatCard label="This week" value={fx.fixtures.length} sub={`fixture${fx.fixtures.length === 1 ? "" : "s"} in the next 7 days`} tone={fx.fixtures.length > 0 ? "accent" : undefined} onClick={goFixtures} />
        )}

        {/* Membership (venue-wide) */}
        {mem.loading ? (
          <StatCard label="Membership" value="…" sub="Loading" />
        ) : mem.error ? (
          <StatCard label="Membership" value="—" sub={<button className="btn btn-ghost btn-xs" onClick={loadMembership}>Try again</button>} tone="crit" />
        ) : (
          <StatCard label="Membership" value={Number(mm.active) || 0} sub={`active · ${fmtGbp(mm.mrr_pence)}/mo · across this venue`} tone="accent" onClick={goMemberships} />
        )}
      </div>

      {/* Detail: DBS attention + upcoming fixtures */}
      <div className="card-grid" style={{ marginTop: "var(--gap-2)" }}>
        <div className="card card-pad">
          <SectionHead label="DBS attention">
            {onView && <button type="button" className="btn btn-ghost btn-xs" onClick={goStaff}>View all</button>}
          </SectionHead>
          {dbs.loading ? (
            <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Checking clearances…</p>
          ) : dbs.error ? (
            <p style={{ color: "var(--live)", fontSize: 13 }}>Couldn’t load DBS status.</p>
          ) : activeStaff.length === 0 ? (
            <EmptyState title="No coaches yet" body="Coaches added under Staff will show their DBS status here." />
          ) : dbsClear ? (
            <EmptyState title="All clear" body="Every active coach has a valid DBS." />
          ) : (
            <div>
              {issues.slice(0, 5).map((it, i) => (
                <DetailRow key={i} tone={it.level}
                  left={`${it.name}${it.team ? ` · ${it.team}` : ""}`} right={it.reason} />
              ))}
              {issues.length > 5 && (
                <p style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 8 }}>+{issues.length - 5} more — see Staff.</p>
              )}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <SectionHead label="This week">
            {onView && <button type="button" className="btn btn-ghost btn-xs" onClick={goFixtures}>View all</button>}
          </SectionHead>
          {fx.loading ? (
            <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading fixtures…</p>
          ) : fx.error ? (
            <p style={{ color: "var(--live)", fontSize: 13 }}>Couldn’t load fixtures.</p>
          ) : fx.fixtures.length === 0 ? (
            <EmptyState title="Nothing scheduled" body="No fixtures at this venue in the next 7 days." />
          ) : (
            <div>
              {fx.fixtures.slice(0, 5).map((f, i) => (
                <DetailRow key={i}
                  left={`${f.club_team_name || "Our team"} ${f.is_home ? "vs" : "@"} ${f.opponent_name || "TBC"}`}
                  right={`${DOW[f.when.getDay()]} ${f.kickoff_time || ""}`.trim()} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
