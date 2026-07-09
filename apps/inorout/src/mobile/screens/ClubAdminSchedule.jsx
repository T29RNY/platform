// ClubAdminSchedule.jsx — Club-admin track, secondary /hub screen ("Schedule"),
// opened from the More hub for a club_admin role. The read-only forward look at the
// ONE club whose shell venue the caller owns: upcoming training sessions + league
// fixtures, in two dated sections (Club Console PR #6b, Decision 10).
//
// A glance-only companion to ClubAdminToday ("what needs me now") — this is "what's
// coming up". No writes: creating/editing sessions + fixtures stays on the desktop
// console. The admin here just sees the diary.
//
// AUTH: the club admin passes their shell venue_id as the credential (venueToken =
// role.entityId). Every reader below authenticates it via resolve_venue_caller and
// scopes by clubId — the same venue-token path the desktop club lens uses.
//
// Reuses existing venue-token wrappers only (no new backend):
//   • clubListSessions(venueToken, clubId, {from})   → training sessions
//   • venueListClubLeagues(venueToken, clubId)        → the club's leagues
//   • venueListClubFixtures(venueToken, leagueId)     → per-league fixtures (2-step)
//
// VERIFIED SHAPES (RPC bodies mig 412 §10 + mig 394; desktop call site
// apps/venue/src/views/ClubHome.jsx loadFixtures + SessionsView):
//   clubListSessions → BARE ARRAY of { session_id, title, scheduled_at (timestamptz),
//     location, venue_name, playing_area_name, cohort_name, status, cancelled_reason }.
//     Filter p_from is scheduled_at >= from; status can be 'cancelled'.
//   venueListClubLeagues → { ok, leagues:[{ league_id, name, archived, ... }] }
//     (ClubHome reads lRes?.leagues ?? array). archived = archived_at IS NOT NULL.
//   venueListClubFixtures → { ok, fixtures:[{ fixture_id, club_team_name, opponent_name,
//     is_home, scheduled_date (date), kickoff_time ('HH:MM' text), pitch_name, status }] }
//     (ClubHome reads fRes?.fixtures ?? array; upcoming = status==='scheduled').
//
// Renders inside the scoped [data-surface="mobile"] tree → shell amber tokens only.

import { useState, useEffect, useCallback } from "react";
import { clubListSessions, venueListClubLeagues, venueListClubFixtures } from "@platform/core";
import MIcon from "../icons.jsx";

// timestamptz / ISO → friendly { date, time }. No date lib — toLocale* only.
function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "TBC", time: "" };
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}

// A pure calendar date ('YYYY-MM-DD') + 'HH:MM' kickoff → friendly { date, time }.
function fmtFixture(dateStr, kickoff) {
  const d = new Date(String(dateStr) + "T" + (kickoff || "00:00") + ":00");
  const date = isNaN(d.getTime())
    ? "TBC"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return { date, time: kickoff || "" };
}

export default function ClubAdminSchedule({ venueToken, clubId, clubName, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, sessions: [], fixtures: [] });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setState({ loading: false, error: false, sessions: [], fixtures: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    // Start of local today — the forward window for both readers.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    try {
      // Sessions is the primary reader → a hard failure surfaces the error triad.
      // Leagues is secondary → soft-caught so the sessions list still renders.
      const [sessRaw, lRes] = await Promise.all([
        clubListSessions(venueToken, clubId, { from: start.toISOString() }),
        venueListClubLeagues(venueToken, clubId).catch(() => null),
      ]);

      const sessions = (Array.isArray(sessRaw) ? sessRaw : [])
        .filter((s) => s.status !== "cancelled" && s.scheduled_at)
        .map((s) => ({ ...s, when: new Date(s.scheduled_at) }))
        .filter((s) => !isNaN(s.when.getTime()) && s.when >= start)
        .sort((a, b) => a.when - b.when);

      // Two-step fixtures: leagues → per-league fixtures (mirrors ClubHome).
      const leagues = (lRes?.leagues ?? (Array.isArray(lRes) ? lRes : [])).filter((l) => !l.archived);
      const fxArrays = await Promise.all(leagues.map((lg) =>
        venueListClubFixtures(venueToken, lg.league_id)
          .then((r) => (r?.fixtures ?? (Array.isArray(r) ? r : [])).map((f) => ({ ...f, league_name: lg.name })))
          .catch(() => [])
      ));
      const fixtures = fxArrays.flat()
        .filter((f) => f.status === "scheduled" && f.scheduled_date)
        .map((f) => ({ ...f, when: new Date(String(f.scheduled_date) + "T" + (f.kickoff_time || "00:00") + ":00") }))
        .filter((f) => !isNaN(f.when.getTime()) && f.when >= start)
        .sort((a, b) => a.when - b.when);

      setState({ loading: false, error: false, sessions, fixtures });
    } catch {
      setState({ loading: false, error: true, sessions: [], fixtures: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, sessions, fixtures } = state;

  if (loading) return <Frame onBack={onBack}><Note>Loading {clubName || "your club"}'s schedule…</Note></Frame>;
  if (error) {
    return (
      <Frame onBack={onBack}>
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 14, margin: 0 }}>Couldn't load the schedule right now.</p>
          <button onClick={load} style={pillBtn}>Try again</button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame onBack={onBack}>
      <div className="m-eyebrow" style={{ margin: "2px 2px 4px" }}>{clubName || "Your club"} · schedule</div>

      <SecHead icon="calendar" title="Training" meta={sessions.length ? `${sessions.length}` : ""} />
      {sessions.length === 0
        ? <Note>No upcoming training sessions. Add them from the desktop console.</Note>
        : sessions.map((s) => {
            const t = fmtStamp(s.scheduled_at);
            const where = [s.location || s.venue_name || s.playing_area_name, s.cohort_name].filter(Boolean).join(" · ");
            return (
              <Row key={s.session_id} date={t.date} time={t.time} icon="calendar"
                title={s.title || "Training"} sub={where || "Training session"} />
            );
          })}

      <SecHead icon="trophy" title="Fixtures" meta={fixtures.length ? `${fixtures.length}` : ""} />
      {fixtures.length === 0
        ? <Note>No upcoming league fixtures.</Note>
        : fixtures.map((f) => {
            const t = fmtFixture(f.scheduled_date, f.kickoff_time);
            const title = `${f.club_team_name || "Our team"} vs ${f.opponent_name || "TBC"}`;
            const sub = [f.is_home ? "Home" : "Away", f.pitch_name || f.league_name].filter(Boolean).join(" · ");
            return (
              <Row key={f.fixture_id} date={t.date} time={t.time} icon="trophy"
                title={title} sub={sub} game />
            );
          })}
    </Frame>
  );
}

// A single dated schedule row: left date/time block · glyph chip · title + sub.
// game=true = amber-accented competitive fixture (left rule + amber chip).
function Row({ date, time, icon, title, sub, game = false }) {
  return (
    <div className="m-card" style={{
      padding: "12px 13px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
      borderLeft: game ? "3px solid var(--amber)" : "3px solid transparent",
    }}>
      <div style={{ width: 52, flex: "none", textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink2)", letterSpacing: "-0.01em" }}>{date}</div>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>{time || "TBC"}</div>
      </div>
      <div style={{
        width: 36, height: 36, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        background: game ? "var(--amber-soft)" : "var(--s4)",
      }}>
        <MIcon name={icon} size={18} color={game ? "var(--amber)" : "var(--ink2)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub || ""}</div>
      </div>
    </div>
  );
}

function SecHead({ icon, title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MIcon name={icon} size={17} color="var(--ink2)" />
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      </div>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function Frame({ children, onBack }) {
  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer",
          background: "transparent", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontWeight: 600, fontSize: 13.5, padding: "2px 0",
        }}>
          <MIcon name="chevleft" size={16} /> More
        </button>
      )}
      {children}
    </div>
  );
}

function Note({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}

const pillBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};
