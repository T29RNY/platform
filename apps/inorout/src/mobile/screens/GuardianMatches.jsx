// GuardianMatches.jsx — Guardian track, screen 1 (mounted at /hub, tab "matches").
//
// Honest build of design_handoff_guardian_app/m-guardian.jsx GuardianMatches:
//   • Top  : "no match in play" card → next fixture (real live data does not exist
//            for grassroots club_fixtures, so the live banner is deliberately the
//            empty state — Phase 1 decision).
//   • Up next: the child's upcoming FA grassroots league fixtures with working
//            In/Out availability (guardian_set_fixture_availability, mig 426).
//   • Recent results: completed fixtures with scores + W/D/L.
//
// Data: guardian_list_child_fixtures(child_profile_id) (mig 426). Renders inside
// the scoped [data-surface="mobile"] tree, so it uses the shell's amber tokens
// and never the prototype's standalone stylesheet.

import { useState, useEffect, useCallback } from "react";
import { guardianListChildFixtures, guardianSetFixtureAvailability } from "@platform/core";
import MIcon from "../icons.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-06-21" → { day:"Sat", dm:"21 Jun" }. Parsed as local date parts (no TZ shift).
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

// Deterministic crest tint from the opponent's free-text name (no brand colour
// stored). HSL (not hex) so it stays inside the no-hardcoded-hex rule.
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function Crest({ name, size = 38, r = 11 }) {
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

function resultOf(us, them) { return us > them ? "W" : us < them ? "L" : "D"; }

// selfMode (Club Console PR #6): reuse for the adult member's OWN matches.
// childId is the caller's own member_profiles.id (guardian_set_fixture_availability
// accepts the self id — its guardian-edge check is skipped when for_profile == caller).
// Only the copy switches to self-voice.
export default function GuardianMatches({ childId, childFirst, toast, selfMode = false }) {
  const [state, setState] = useState({ loading: true, error: false, upcoming: [], recent: [] });
  const [rsvp, setRsvp] = useState({});       // fixture_id → in|out|maybe
  const [saving, setSaving] = useState({});   // fixture_id → bool (double-fire guard)

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, upcoming: [], recent: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await guardianListChildFixtures(childId);
      const upcoming = res?.upcoming || [];
      const recent = res?.recent || [];
      setRsvp(Object.fromEntries(upcoming.filter((f) => f.own_rsvp_status).map((f) => [f.fixture_id, f.own_rsvp_status])));
      setState({ loading: false, error: false, upcoming, recent });
    } catch {
      setState({ loading: false, error: true, upcoming: [], recent: [] });
    }
  }, [childId]);

  useEffect(() => { load(); }, [load]);

  const setAvail = async (fx, next) => {
    if (saving[fx.fixture_id]) return;
    const prev = rsvp[fx.fixture_id] || null;
    setRsvp((s) => ({ ...s, [fx.fixture_id]: next }));               // optimistic
    setSaving((s) => ({ ...s, [fx.fixture_id]: true }));
    try {
      await guardianSetFixtureAvailability(fx.fixture_id, next, { forProfileId: childId });
      toast?.({
        icon: next === "in" ? "check" : "alert",
        text: next === "in"
          ? (selfMode ? "Marked available" : `${childFirst} marked available`)
          : (selfMode ? "Marked unavailable" : `${childFirst} marked unavailable`),
        sub: `vs ${fx.opponent_name}`,
      });
    } catch {
      setRsvp((s) => ({ ...s, [fx.fixture_id]: prev }));            // revert
      toast?.({ icon: "alert", text: "Couldn't save — try again" });
    } finally {
      setSaving((s) => ({ ...s, [fx.fixture_id]: false }));
    }
  };

  const { loading, error, upcoming, recent } = state;
  const next = upcoming[0] || null;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Matches</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {selfMode ? "your" : (childFirst ? `${childFirst}'s` : "your")} matches…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Matches</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load matches right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      {/* LIVE — honest empty state (no live data for grassroots fixtures yet) */}
      <div className="m-eyebrow" style={{ margin: "8px 2px 10px" }}>
        {selfMode ? "Your" : (childFirst ? `${childFirst}'s` : "Your")} team · no live match
      </div>
      <div className="m-card" style={{ padding: "16px 15px", display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 13, flex: "none", background: "var(--s4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><MIcon name="clock" size={20} color="var(--ink3)" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No match in play right now</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
            {next
              ? `Next: ${fmtDate(next.scheduled_date).day} ${fmtDate(next.scheduled_date).dm} · ${next.is_home ? "vs" : "away to"} ${next.opponent_name}`
              : "No upcoming fixtures scheduled"}
          </div>
        </div>
      </div>

      {/* UP NEXT + availability */}
      <SecHead title="Up next" meta={`${selfMode ? "your" : (childFirst || "your")} availability`} />
      {upcoming.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          No upcoming league fixtures.
        </div>
      )}
      {upcoming.map((f) => {
        const d = fmtDate(f.scheduled_date);
        const mine = rsvp[f.fixture_id] || null;
        const busy = !!saving[f.fixture_id];
        return (
          <div key={f.fixture_id} className="m-card" style={{ padding: "13px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 50, flex: "none", textAlign: "center" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)" }}>{d.day} {d.dm.split(" ")[0]}</div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 1 }}>{f.kickoff_time || "TBC"}</div>
              </div>
              <Crest name={f.opponent_name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.opponent_name}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{
                    height: 18, fontSize: 10, padding: "0 7px", flex: "none", borderRadius: "var(--r-pill)",
                    display: "inline-flex", alignItems: "center", background: "var(--s3)", color: "var(--ink2)", fontWeight: 700,
                  }}>{f.is_home ? "Home" : "Away"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.pitch_name || f.venue_name || f.league_name || ""}</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--hair)" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 600, flex: 1 }}>
                {mine === "in"
                  ? (selfMode ? "You're in" : `${childFirst} is available`)
                  : mine === "out"
                  ? (selfMode ? "You're out" : `${childFirst} can't make it`)
                  : (selfMode ? "Available?" : `Is ${childFirst} available?`)}
              </span>
              <AvailBtn on={mine === "in"} tone="ok" busy={busy} onClick={() => setAvail(f, "in")} icon="check" label="In" />
              <AvailBtn on={mine === "out"} tone="live" busy={busy} onClick={() => setAvail(f, "out")} label="Out" />
            </div>
          </div>
        );
      })}

      {/* RECENT RESULTS */}
      <SecHead title="Recent results" meta={recent.length ? `last ${recent.length}` : ""} />
      {recent.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>
          No results yet.
        </div>
      )}
      {recent.map((r) => {
        const us = r.is_home ? r.home_score : r.away_score;
        const them = r.is_home ? r.away_score : r.home_score;
        const hasScore = us != null && them != null;
        const res = hasScore ? resultOf(us, them) : null;
        const d = fmtDate(r.scheduled_date);
        const col = res === "W" ? "var(--ok-ink)" : res === "L" ? "var(--live-ink)" : "var(--ink2)";
        const bg = res === "W" ? "var(--ok-soft)" : res === "L" ? "var(--live-soft)" : "var(--s3)";
        return (
          <div key={r.fixture_id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 9, flex: "none", display: "flex", alignItems: "center",
              justifyContent: "center", background: bg, color: col, fontSize: 13, fontWeight: 800,
            }}>{res || "–"}</span>
            <Crest name={r.opponent_name} size={34} r={9} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.opponent_name} <span style={{ color: "var(--ink4)", fontWeight: 500 }}>({r.is_home ? "H" : "A"})</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{d.day} {d.dm}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", flex: "none", color: "var(--ink)" }}>
              {hasScore ? <>{us}<span style={{ color: "var(--ink4)", margin: "0 3px" }}>–</span>{them}</> : <span style={{ color: "var(--ink4)", fontSize: 13, fontWeight: 600 }}>result TBC</span>}
            </div>
          </div>
        );
      })}
    </div>
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

function AvailBtn({ on, tone, busy, onClick, icon, label }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  const line = tone === "ok" ? "var(--ok)" : "var(--live)";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        height: 30, padding: "0 13px", cursor: busy ? "default" : "pointer", borderRadius: "var(--r-pill)",
        display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--m-font)", fontSize: 12.5, fontWeight: 700,
        opacity: busy ? 0.6 : 1, border: "1px solid",
        background: on ? soft : "transparent",
        color: on ? ink : "var(--ink3)",
        borderColor: on ? line : "var(--hair2)",
      }}
    >
      {icon ? <MIcon name={icon} size={13} /> : null}{label}
    </button>
  );
}
