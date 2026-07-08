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

import { useState, useEffect, useCallback } from "react";
import { clubManagerListTeamFixtures } from "@platform/core";

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

export default function TeamManagerTonight({ toast }) {
  const [state, setState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);

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

      {next && <NextFixture f={next} teamName={team.team_name} />}

      {rest.length > 0 && (
        <>
          <SecHead title="Coming up" meta={`${rest.length} more`} />
          {rest.map((f) => <MiniFixture key={f.fixture_id} f={f} />)}
        </>
      )}
    </div>
  );
}

// The hero: the next fixture with its availability board shown inline.
function NextFixture({ f, teamName }) {
  const d = fmtDate(f.scheduled_date);
  const c = f.counts || { in: 0, out: 0, maybe: 0, pending: 0, total: 0 };
  const roster = f.roster || [];
  const where = f.pitch_name || f.venue_name || f.league_name || "";
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
          return (
            <div key={p.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px" }}>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A compact further-ahead fixture row (date · opponent · count summary).
function MiniFixture({ f }) {
  const d = fmtDate(f.scheduled_date);
  const c = f.counts || { in: 0, out: 0, maybe: 0, pending: 0, total: 0 };
  return (
    <div className="m-card" style={{ padding: "11px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12 }}>
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
    </div>
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
