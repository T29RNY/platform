// TeamManagerTonight.jsx — Team-manager track, "Tonight" tab (/hub, tab "tonight").
//
// Club Manager epic PR #4: the coach's matchday-focus view — the NEXT fixture with
// its full availability board front-and-centre (who's in / out / maybe / no reply),
// then a compact "coming up" list. Read-only (the coach observes availability;
// setting it on a player's behalf is a later screen). Data source is the same
// param-less, coach-scoped reader as the League tab — club_manager_list_team_fixtures()
// (mig 451) — so this is purely additive: a new screen over an existing wrapper.
//
// Renders inside the scoped [data-surface="mobile"] tree → shell amber tokens only.
// Helpers are re-declared locally (not imported from TeamManagerLeague) to keep the
// diff additive — no existing screen is touched.
//
// TAPPABLE FIXTURES (this pass): the next-fixture hero and each "coming up" row drill
// into TeamManagerMatchday (team sheet + result) — the SAME local drill-in League
// already uses, so the coach reaches the matchday sheet from their landing tab too.
// Additive: reuses the existing Matchday screen + wrapper, no MobileShell route change,
// no backend.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { clubManagerListTeamFixtures, clubManagerListUpcomingSessions, pitchStatusMeta } from "@platform/core";
import MIcon from "../icons.jsx";
import TeamManagerMatchday from "./TeamManagerMatchday.jsx";
import CoachMemberDetailSheet from "./CoachMemberDetailSheet.jsx";
import SessionRsvpSheet from "./SessionRsvpSheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(iso) {
  if (!iso) return { day: "", dm: "TBC" };
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return { day: "", dm: "TBC" };
  const dt = new Date(y, m - 1, d);
  return { day: DAYS[dt.getDay()], dm: `${d} ${MONTHS[m - 1]}` };
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 44, r = 12 }) {
  const hue = hueFor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(135deg, hsl(${hue} 46% 40%) 0 52%, hsl(${hue} 46% 30%) 100%)`,
      color: "white", fontSize: size * 0.36, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(name)}</div>
  );
}

const AVAIL = {
  in:      { soft: "var(--ok-soft)",    ink: "var(--ok-ink)",   label: "In" },
  out:     { soft: "var(--live-soft)",  ink: "var(--live-ink)", label: "Out" },
  maybe:   { soft: "var(--amber-soft)", ink: "var(--amber)",    label: "Maybe" },
  pending: { soft: "var(--s3)",         ink: "var(--ink3)",     label: "No reply" },
};

// Training/social sessions store scheduled_at as a timestamptz (UTC instant) — convert
// UTC→viewer-local via toLocale* (matches the Training screen + desktop), NOT a raw read,
// or a BST 18:30 would show an hour early. (Fixtures differ: kickoff_time is plain text.)
function fmtSession(iso) {
  if (!iso) return { d: "TBC", t: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { d: "TBC", t: "" };
  return {
    d: dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    t: dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

export default function TeamManagerTonight({ toast }) {
  const [state, setState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [openFixture, setOpenFixture] = useState(null);  // drill-in matchday detail
  const [detailFor, setDetailFor] = useState(null);      // roster row tap → { member_profile_id, name } (mig 526)
  const [trainingBoardFor, setTrainingBoardFor] = useState(null); // training row tap → availability board

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await clubManagerListTeamFixtures();
      setState({ loading: false, error: false, teams: res?.teams || [] });
    } catch {
      setState({ loading: false, error: true, teams: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { loading, error, teams } = state;
  const team = teams[teamIdx] || teams[0] || null;
  const clubId = team?.club_id || null;
  const teamId = team?.team_id || null;

  // Upcoming TRAINING for this team (P2.1) — the same club-scoped reader the Training
  // screen + desktop use, filtered to this team + training/social. A SOFT add: any
  // failure just hides the section, it never blocks the fixtures view.
  const [sessions, setSessions] = useState({ loading: false, rows: [] });
  const sessReqRef = useRef(0);
  const loadSessions = useCallback(async () => {
    if (!clubId) { setSessions({ loading: false, rows: [] }); return; }
    const reqId = ++sessReqRef.current;
    setSessions({ loading: true, rows: [] });
    try {
      const data = await clubManagerListUpcomingSessions(clubId);
      if (reqId !== sessReqRef.current) return;
      const rows = Array.isArray(data?.sessions) ? data.sessions : Array.isArray(data) ? data : [];
      setSessions({ loading: false, rows });
    } catch {
      if (reqId !== sessReqRef.current) return;
      setSessions({ loading: false, rows: [] });
    }
  }, [clubId]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const training = useMemo(() => (sessions.rows || [])
    .filter((s) => String(s.team_id) === String(teamId))
    .filter((s) => s.session_type === "training" || s.session_type === "social")
    .sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0))
    .slice(0, 3), [sessions.rows, teamId]);

  // matchday drill-in (tap a fixture) — mirrors TeamManagerLeague; reload on back so
  // a saved result/lineup is reflected in the availability board. AFTER all hooks.
  if (openFixture) {
    return (
      <TeamManagerMatchday
        fixtureId={openFixture}
        toast={toast}
        onBack={() => { setOpenFixture(null); load(); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Tonight</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading your matchday…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Tonight</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your fixtures right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }
  if (!team) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Tonight</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>No teams to manage yet.</p>
      </div>
    );
  }

  const upcoming = team.upcoming || [];
  const next = upcoming[0] || null;
  const rest = upcoming.slice(1);

  return (
    <div>
      {teams.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 4px" }}>
          {teams.map((t, i) => {
            const on = i === teamIdx;
            return (
              <button key={t.team_id} onClick={() => setTeamIdx(i)} style={{
                height: 32, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
                fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700, border: "1px solid",
                background: on ? "var(--amber-soft)" : "transparent",
                color: on ? "var(--amber)" : "var(--ink3)",
                borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
              }}>{t.team_name}</button>
            );
          })}
        </div>
      )}

      {!next && (
        <div className="m-card" style={{ marginTop: 8, padding: "16px 15px" }}>
          <div className="m-eyebrow">Up next</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Nothing on the horizon for {team.team_name}. Enjoy the quiet.</p>
        </div>
      )}

      {next && <NextFixture f={next} teamName={team.team_name} onOpen={() => setOpenFixture(next.fixture_id)} onTapPlayer={setDetailFor} />}

      {rest.length > 0 && (
        <>
          <SecHead title="Coming up" meta={`${rest.length} more`} />
          {rest.map((f) => <MiniFixture key={f.fixture_id} f={f} onOpen={() => setOpenFixture(f.fixture_id)} />)}
        </>
      )}

      {/* Upcoming TRAINING — reuses the club session reader; manage under More → Training */}
      {training.length > 0 && (
        <>
          <SecHead title="Upcoming training" meta={training.length >= 3 ? "next 3" : ""} />
          {training.map((s) => {
            const w = fmtSession(s.scheduled_at);
            const pmeta = pitchStatusMeta(s.pitch_status);
            return (
              <button key={s.session_id || s.id} onClick={() => setTrainingBoardFor(s)} aria-label="See who's available" className="m-card" style={{
                width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
                padding: "11px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <MIcon name="calendar" size={17} color="var(--amber)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || (s.session_type === "social" ? "Social" : "Training")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[w.d, w.t, pmeta.showSlot ? (s.location || s.venue_name) : pmeta.label].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <MIcon name="users" size={15} color="var(--ink4)" />
              </button>
            );
          })}
        </>
      )}

      {detailFor && (
        <CoachMemberDetailSheet
          memberProfileId={detailFor.member_profile_id}
          name={detailFor.name}
          onClose={() => setDetailFor(null)}
        />
      )}

      {trainingBoardFor && <SessionRsvpSheet session={trainingBoardFor} onClose={() => setTrainingBoardFor(null)} />}
    </div>
  );
}

// The hero: the next fixture with its availability board shown inline.
function NextFixture({ f, teamName, onOpen, onTapPlayer }) {
  const d = fmtDate(f.scheduled_date);
  const c = f.counts || { in: 0, out: 0, maybe: 0, pending: 0, total: 0 };
  const roster = f.roster || [];
  const where = f.location || f.pitch_name || f.venue_name || f.league_name || "";
  return (
    <div className="m-card" style={{ marginTop: 8, padding: "15px 15px 13px" }}>
      <div className="m-eyebrow">Up next · {teamName}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginTop: 11 }}>
        <Crest name={f.opponent_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.opponent_name}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
            {d.day} {d.dm} · {f.kickoff_time || "TBC"} · {f.is_home ? "Home" : "Away"}
          </div>
          {where && <div style={{ fontSize: 12, color: "var(--ink4)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{where}</div>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--hair)" }}>
        <CountPill status="in" n={c.in} />
        <CountPill status="out" n={c.out} />
        <CountPill status="maybe" n={c.maybe} />
        <CountPill status="pending" n={c.pending} />
      </div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
        {roster.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "4px 2px" }}>No squad members yet.</div>
        )}
        {roster.map((p, i) => {
          const a = AVAIL[p.status] || AVAIL.pending;
          const tappable = !!(p.member_profile_id && onTapPlayer);
          return (
            <button
              key={(p.member_profile_id || p.name) + "·" + i}
              onClick={tappable ? () => onTapPlayer({ member_profile_id: p.member_profile_id, name: p.name }) : undefined}
              style={{
                width: "100%", textAlign: "left", font: "inherit", color: "inherit",
                background: "transparent", border: "none", cursor: tappable ? "pointer" : "default",
                display: "flex", alignItems: "center", gap: 10, padding: "7px 2px",
              }}
            >
              <span style={{
                width: 26, height: 26, borderRadius: 8, flex: "none", display: "flex", alignItems: "center",
                justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 10.5, fontWeight: 800,
              }}>{initials(p.name)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{
                height: 22, padding: "0 10px", borderRadius: "var(--r-pill)", flex: "none",
                display: "inline-flex", alignItems: "center", fontSize: 11.5, fontWeight: 700,
                background: a.soft, color: a.ink,
              }}>{a.label}</span>
              {tappable && <MIcon name="chevron" size={13} color="var(--ink4)" />}
            </button>
          );
        })}
      </div>

      {/* matchday drill-in: pick the XI + log the result (mirrors League's FixtureCard) */}
      <button
        onClick={onOpen}
        style={{
          width: "100%", marginTop: 12, padding: "10px", borderRadius: "var(--r-pill)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
          fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700,
        }}
      >
        Team sheet &amp; result
        <MIcon name="chevron" size={14} color="var(--amber)" />
      </button>
    </div>
  );
}

// A compact further-ahead fixture row (date · opponent · count summary). Tap → matchday.
function MiniFixture({ f, onOpen }) {
  const d = fmtDate(f.scheduled_date);
  const c = f.counts || { in: 0, out: 0, maybe: 0, pending: 0, total: 0 };
  return (
    <button onClick={onOpen} className="m-card" style={{
      width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
      padding: "11px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ width: 46, flex: "none", textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>{d.day} {d.dm.split(" ")[0]}</div>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>{f.kickoff_time || "TBC"}</div>
      </div>
      <Crest name={f.opponent_name} size={32} r={9} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.opponent_name}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>{f.is_home ? "Home" : "Away"}</div>
      </div>
      <span style={{
        height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
        display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700,
        background: "var(--ok-soft)", color: "var(--ok-ink)",
      }}>{c.in}<span style={{ fontSize: 10, opacity: 0.85 }}>in</span></span>
      <MIcon name="chevron" size={15} color="var(--ink4)" />
    </button>
  );
}

function CountPill({ status, n }) {
  const a = AVAIL[status];
  return (
    <span style={{
      height: 24, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
      background: a.soft, color: a.ink,
    }}>{n}<span style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 600 }}>{a.label}</span></span>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}
