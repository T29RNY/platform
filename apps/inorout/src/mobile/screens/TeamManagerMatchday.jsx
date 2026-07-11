// TeamManagerMatchday.jsx — Club Manager epic PR #8. The coach's one-thumb matchday:
// pick who's playing (Start / Bench / Out), then log the result — score + per-player
// goals/assists/cards + Player of the Match. Reached by tapping a fixture in
// TeamManagerLeague (local drill-in, no MobileShell route change → additive + casual-safe).
//
// Coach-auth RPCs (mig 516): clubManagerGetFixtureDetail / clubManagerSetFixtureLineup /
// clubManagerRecordFixtureStats. Renders inside [data-surface="mobile"] → shell tokens only.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  clubManagerGetFixtureDetail,
  clubManagerSetFixtureLineup,
  clubManagerRecordFixtureStats,
} from "@platform/core";
import MIcon from "../icons.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmtDate(iso) {
  if (!iso) return "TBC";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "TBC";
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
}
function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Start → Bench → Out cycle.
const SEL = { start: "Start", bench: "Bench", out: "Out" };
const SEL_TOKEN = {
  start: { soft: "var(--ok-soft)", ink: "var(--ok-ink)" },
  bench: { soft: "var(--amber-soft)", ink: "var(--amber)" },
  out: { soft: "var(--s3)", ink: "var(--ink3)" },
};

// A compact −/value/+ stepper for cold thumbs.
function Stepper({ label, value, onChange, min = 0, max = 20 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: "var(--ink3)", width: 34, fontWeight: 700 }}>{label}</span>
      <button aria-label={`${label} minus`} onClick={() => onChange(Math.max(min, value - 1))} style={stepBtn}>−</button>
      <span style={{ minWidth: 16, textAlign: "center", fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{value}</span>
      <button aria-label={`${label} plus`} onClick={() => onChange(Math.min(max, value + 1))} style={stepBtn}>+</button>
    </div>
  );
}
const stepBtn = {
  width: 30, height: 30, borderRadius: 9, flex: "none", cursor: "pointer",
  background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink)",
  fontSize: 18, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
};

export default function TeamManagerMatchday({ fixtureId, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, detail: null });
  const [sel, setSel] = useState({});           // member_profile_id → start|bench|out
  const [stats, setStats] = useState({});        // member_profile_id → {goals,assists,yellow,red}
  const [potm, setPotm] = useState(null);        // member_profile_id | null
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const savingLineup = useRef(false);
  const savingResult = useRef(false);
  const [busyL, setBusyL] = useState(false);
  const [busyR, setBusyR] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const d = await clubManagerGetFixtureDetail(fixtureId);
      const roster = d?.roster || [];
      const existingStats = d?.stats || [];
      const statById = Object.fromEntries(existingStats.map((s) => [s.member_profile_id, s]));
      // seed selection: existing lineup wins; else availability ("in" → start, else out)
      const nextSel = {}, nextStats = {};
      let nextPotm = null;
      roster.forEach((r) => {
        const id = r.member_profile_id;
        nextSel[id] = r.selected ? (r.is_starter ? "start" : "bench") : (r.status === "in" ? "start" : "out");
        const st = statById[id];
        nextStats[id] = {
          goals: st?.goals || 0, assists: st?.assists || 0,
          yellow: st?.yellow_cards || 0, red: st?.red_cards || 0,
        };
        if (st?.is_potm) nextPotm = id;
      });
      setSel(nextSel); setStats(nextStats); setPotm(nextPotm);
      const fx = d?.fixture || {};
      setHome(fx.home_score ?? 0); setAway(fx.away_score ?? 0);
      setState({ loading: false, error: false, detail: d });
    } catch {
      setState({ loading: false, error: true, detail: null });
    }
  }, [fixtureId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, detail } = state;
  const fx = detail?.fixture || null;
  const roster = detail?.roster || [];

  const cycleSel = (id) => setSel((s) => ({ ...s, [id]: s[id] === "start" ? "bench" : s[id] === "bench" ? "out" : "start" }));
  const setStat = (id, key, v) => setStats((s) => ({ ...s, [id]: { ...s[id], [key]: v } }));

  const saveLineup = useCallback(async () => {
    if (savingLineup.current) return;
    const selections = roster
      .filter((r) => sel[r.member_profile_id] !== "out")
      .map((r, i) => ({ member_profile_id: r.member_profile_id, is_starter: sel[r.member_profile_id] === "start", sort_order: i }));
    savingLineup.current = true; setBusyL(true);
    try {
      await clubManagerSetFixtureLineup(fixtureId, selections);
      toast?.(`Team sheet saved — ${selections.length} selected.`);
    } catch (e) {
      console.error("[matchday] set lineup failed", e);
      toast?.("Couldn't save the team sheet.", "error");
    } finally { savingLineup.current = false; setBusyL(false); }
  }, [roster, sel, fixtureId, toast]);

  const saveResult = useCallback(async () => {
    if (savingResult.current) return;
    // stats only for players who are playing (start/bench)
    const statList = roster
      .filter((r) => sel[r.member_profile_id] !== "out")
      .map((r) => {
        const id = r.member_profile_id; const st = stats[id] || {};
        return {
          member_profile_id: id,
          goals: st.goals || 0, assists: st.assists || 0,
          yellow_cards: st.yellow || 0, red_cards: st.red || 0,
          is_potm: potm === id,
        };
      });
    savingResult.current = true; setBusyR(true);
    try {
      await clubManagerRecordFixtureStats(fixtureId, statList, { homeScore: home, awayScore: away, status: "completed" });
      toast?.("Result saved.");
      load();  // refresh so the fixture reads as completed
    } catch (e) {
      console.error("[matchday] record stats failed", e);
      toast?.("Couldn't save the result.", "error");
    } finally { savingResult.current = false; setBusyR(false); }
  }, [roster, sel, stats, potm, home, away, fixtureId, toast, load]);

  if (loading) {
    return <div className="m-card" style={{ marginTop: 8 }}><p style={{ color: "var(--ink3)", fontSize: 14 }}>Loading matchday…</p></div>;
  }
  if (error || !fx) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <p style={{ color: "var(--ink2)", fontSize: 14 }}>Couldn't load this fixture.</p>
        <button onClick={load} style={retryBtn}>Try again</button>
        <button onClick={onBack} style={{ ...retryBtn, background: "transparent", border: "none", color: "var(--ink3)" }}>Back</button>
      </div>
    );
  }

  const playing = roster.filter((r) => sel[r.member_profile_id] !== "out");

  return (
    <div>
      {/* header */}
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
        cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
      }}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> Fixtures
      </button>
      <div className="m-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em" }}>
          {fx.our_team || "Us"} <span style={{ color: "var(--ink4)", fontWeight: 500 }}>v</span> {fx.opponent_name}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 3 }}>
          {fmtDate(fx.scheduled_date)}{fx.kickoff_time ? ` · ${fx.kickoff_time}` : ""} · {fx.is_home ? "Home" : "Away"}
          {fx.status === "completed" ? " · Result logged" : ""}
        </div>
        {(fx.location || fx.venue_address || fx.venue_name) && (
          <div style={{ fontSize: 12, color: "var(--ink4)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
            <MIcon name="pin" size={12} color="var(--ink4)" />
            {fx.location || fx.venue_address || [fx.venue_name, fx.pitch_name].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      {/* SQUAD SELECTION */}
      <SecHead title="Team sheet" meta={`${playing.length} playing`} />
      {roster.length === 0 && <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No squad members on this team yet.</div>}
      {roster.map((r) => {
        const s = sel[r.member_profile_id] || "out";
        const tk = SEL_TOKEN[s];
        return (
          <div key={r.member_profile_id} className="m-card" style={{ padding: "10px 13px", marginBottom: 7, display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 10.5, fontWeight: 800 }}>{initials(r.name)}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            <button onClick={() => cycleSel(r.member_profile_id)} style={{
              height: 30, minWidth: 66, padding: "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
              fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700, border: "none", background: tk.soft, color: tk.ink,
            }}>{SEL[s]}</button>
          </div>
        );
      })}
      <button onClick={saveLineup} disabled={busyL} style={primaryBtn}>{busyL ? "Saving…" : "Save team sheet"}</button>

      {/* RESULT */}
      <SecHead title="Result" meta="" />
      <div className="m-card" style={{ padding: "14px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 5 }}>{fx.is_home ? "Us" : fx.opponent_name.slice(0, 8)}</div>
            <Stepper label="" value={home} onChange={setHome} max={50} />
          </div>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--ink4)" }}>–</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700, marginBottom: 5 }}>{fx.is_home ? fx.opponent_name.slice(0, 8) : "Us"}</div>
            <Stepper label="" value={away} onChange={setAway} max={50} />
          </div>
        </div>
      </div>

      {playing.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600, margin: "4px 2px 8px" }}>Per-player — tap the star for Player of the Match</div>
          {playing.map((r) => {
            const id = r.member_profile_id; const st = stats[id] || { goals: 0, assists: 0, yellow: 0, red: 0 };
            const isPotm = potm === id;
            return (
              <div key={id} className="m-card" style={{ padding: "11px 13px", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  <button aria-label="Player of the match" onClick={() => setPotm(isPotm ? null : id)} style={{
                    width: 32, height: 32, borderRadius: 9, flex: "none", cursor: "pointer", border: "none",
                    background: isPotm ? "var(--amber-soft)" : "var(--s3)",
                  }}>
                    <MIcon name="star" size={16} color={isPotm ? "var(--amber)" : "var(--ink4)"} />
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <Stepper label="Goals" value={st.goals} onChange={(v) => setStat(id, "goals", v)} />
                  <Stepper label="Assist" value={st.assists} onChange={(v) => setStat(id, "assists", v)} />
                  <Stepper label="Yellow" value={st.yellow} onChange={(v) => setStat(id, "yellow", v)} max={2} />
                  <Stepper label="Red" value={st.red} onChange={(v) => setStat(id, "red", v)} max={1} />
                </div>
              </div>
            );
          })}
        </>
      )}
      <button onClick={saveResult} disabled={busyR} style={primaryBtn}>{busyR ? "Saving…" : "Save result"}</button>
      <div style={{ height: 20 }} />
    </div>
  );
}

const primaryBtn = {
  width: "100%", marginTop: 6, marginBottom: 4, padding: "13px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontFamily: "var(--m-font)",
  fontSize: 14.5, fontWeight: 800,
};
const retryBtn = {
  marginTop: 12, marginRight: 8, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
};

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}
