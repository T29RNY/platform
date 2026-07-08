// TeamManagerSquad.jsx — Club Manager epic PR #7a. The coach's squad intelligence:
// a RELIABILITY board (who actually shows up — the grassroots wedge) + a SMART-TEAMS
// balancer for splitting an available squad into two even sides (training/scrimmage).
//
// Reuses the shared engines UNCHANGED (Decision 4): clubManagerGetTeamRatings (mig 517)
// returns the neutral input shape, then computePlayerRatings + generateBalancedTeams
// (packages/core/engine/*) run exactly as the casual TeamsScreen calls them. For club
// league games the Bradley-Terry skill axis degenerates (no intra-squad A/B) so the
// rating leans on goals/POTM/form — the balancer is a training-split tool, honestly framed.
//
// Drill-in from TeamManagerPeople (local state, no MobileShell route change → additive,
// casual-safe). Renders inside [data-surface="mobile"] → shell amber tokens only.

import { useState, useEffect, useCallback, useMemo } from "react";
import { clubManagerGetTeamRatings, computePlayerRatings, generateBalancedTeams } from "@platform/core";
import MIcon from "../icons.jsx";

const FORM_TOKEN = {
  W: { soft: "var(--ok-soft)", ink: "var(--ok-ink)" },
  L: { soft: "var(--live-soft)", ink: "var(--live-ink)" },
  D: { soft: "var(--s3)", ink: "var(--ink3)" },
};
function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}
// reliability % → token colour (green ≥75, amber ≥50, muted below)
function relToken(pct) {
  if (pct >= 75) return { soft: "var(--ok-soft)", ink: "var(--ok-ink)" };
  if (pct >= 50) return { soft: "var(--amber-soft)", ink: "var(--amber)" };
  return { soft: "var(--s3)", ink: "var(--ink3)" };
}

export default function TeamManagerSquad({ teamId, teamName, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [selected, setSelected] = useState(() => new Set());   // playerIds available tonight
  const [teams, setTeams] = useState(null);                    // { teamA, teamB, predictedWinner }

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await clubManagerGetTeamRatings(teamId);
      const players = data?.players || [];
      setSelected(new Set(players.map((p) => p.playerId)));   // default: everyone in
      setTeams(null);
      setState({ loading: false, error: false, data });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }, [teamId]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const players = data?.players || [];
  const teamGames = data?.totalGamesInPeriod || 0;

  // composite ratings (same call as casual TeamsScreen) — memoised on the payload
  const ratingMap = useMemo(() => {
    if (!data || players.length === 0) return {};
    try {
      return computePlayerRatings(
        { players, matchRows: data.matchRows || [], exactMatchIds: data.exactMatchIds || [] },
        { teamGames },
      ).ratingMap || {};
    } catch { return {}; }
  }, [data, players, teamGames]);

  const nameById = useMemo(() => Object.fromEntries(players.map((p) => [p.playerId, p.name])), [players]);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const balance = useCallback(() => {
    const picked = players.filter((p) => selected.has(p.playerId)).map((p) => ({ id: p.playerId, groupNumber: null }));
    if (picked.length < 2) { toast?.("Pick at least 2 available players.", "error"); return; }
    try {
      const res = generateBalancedTeams(picked, { players }, { teamGames, ratingMap });
      setTeams({ teamA: res?.teamA || [], teamB: res?.teamB || [], predictedWinner: res?.predictedWinner });
    } catch (e) {
      console.error("[squad] balance failed", e);
      toast?.("Couldn't balance the teams.", "error");
    }
  }, [players, selected, ratingMap, teamGames, toast]);

  return (
    <div>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
        cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
      }}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> People
      </button>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "6px 2px 12px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{teamName || "Squad"}</h2>
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>reliability &amp; teams</span>
      </div>

      {loading && <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading squad insights…</div>}
      {error && (
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load squad insights.</p>
          <button onClick={load} style={retryBtn}>Try again</button>
        </div>
      )}

      {!loading && !error && players.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No players in this squad yet.</div>
      )}

      {!loading && !error && players.length > 0 && (
        <>
          {/* RELIABILITY BOARD */}
          <SecHead title="Reliability" meta={`${teamGames} game${teamGames === 1 ? "" : "s"} logged`} />
          <div className="m-card" style={{ padding: "6px 4px" }}>
            {players.map((p) => {
              const rt = relToken(p.reliability);
              const form = Array.isArray(p.form) ? p.form : [];
              return (
                <div key={p.playerId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 11, fontWeight: 800 }}>{initials(p.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>
                      {p.played} played · {p.goals}⚽{p.potm > 0 ? ` · ${p.potm}★` : ""}
                    </div>
                  </div>
                  {form.length > 0 && (
                    <div style={{ display: "flex", gap: 3, flex: "none" }}>
                      {form.slice(0, 5).map((r, i) => {
                        const ft = FORM_TOKEN[r] || FORM_TOKEN.D;
                        return <span key={i} style={{ width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, background: ft.soft, color: ft.ink }}>{r}</span>;
                      })}
                    </div>
                  )}
                  <span style={{ height: 26, minWidth: 44, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, background: rt.soft, color: rt.ink }}>{p.reliability}%</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "8px 4px 0" }}>Reliability = share of the squad's matches this player said they were available for (all-time).</div>

          {/* SMART TEAMS */}
          <SecHead title="Smart Teams" meta="training split" />
          <div style={{ fontSize: 12, color: "var(--ink3)", margin: "0 2px 8px" }}>Tap to set who's available tonight, then balance two even sides.</div>
          <div className="m-card" style={{ padding: "6px 4px" }}>
            {players.map((p) => {
              const on = selected.has(p.playerId);
              return (
                <button key={p.playerId} onClick={() => toggle(p.playerId)} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--m-font)", textAlign: "left",
                }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: on ? "var(--ok-soft)" : "var(--s3)", color: on ? "var(--ok-ink)" : "var(--ink4)" }}>
                    {on ? <MIcon name="check" size={13} color="var(--ok-ink)" /> : null}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: on ? "var(--ink)" : "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                </button>
              );
            })}
          </div>
          <button onClick={balance} style={primaryBtn}>Balance {selected.size} player{selected.size === 1 ? "" : "s"}</button>

          {teams && (
            <div className="tiles" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              {[["Team A", teams.teamA], ["Team B", teams.teamB]].map(([label, ids]) => (
                <div key={label} className="m-card" style={{ padding: "12px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>{label} <span style={{ color: "var(--ink4)", fontWeight: 600 }}>({ids.length})</span></div>
                  {ids.map((id) => (
                    <div key={id} style={{ fontSize: 13, color: "var(--ink2)", padding: "3px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameById[id] || "Player"}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {teams && (
            <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "8px 4px 20px" }}>Balanced on goals, POTM and recent form. Club league games don't feed an individual-skill rating, so treat this as a fair training split, not a power ranking.</div>
          )}
        </>
      )}
    </div>
  );
}

const primaryBtn = {
  width: "100%", marginTop: 8, marginBottom: 4, padding: "12px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontFamily: "var(--m-font)", fontSize: 14, fontWeight: 800,
};
const retryBtn = {
  marginTop: 10, padding: "8px 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13,
};

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "20px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}
