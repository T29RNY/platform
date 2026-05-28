import { useState, useEffect } from "react";
import { getPlayerFixtureDetail } from "@platform/core";
import OppositionIntel from "./OppositionIntel";

// League Mode Phase 5 Cycle 5.4 — inline fixture-detail body, rendered when a
// fixture row in CompetitionFixturesCard is expanded. Read-only. Fetches lazily
// on mount (mounted only on expand). Shows both teams' LIVE registered squads
// (the confirmed matchday XI arrives in 5.6), kickoff countdown for upcoming,
// score + goal events for completed, and a nested OppositionIntel block.
const PAST = ["completed", "walkover", "forfeit", "void"];

function countdownText(dateISO, timeStr) {
  if (!dateISO) return null;
  const target = new Date(`${dateISO}T${timeStr || "00:00:00"}`);
  if (isNaN(target)) return null;
  const ms = target - new Date();
  if (ms <= 0) return "Kicking off";
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `in ${days}d ${hrs}h`;
  if (hrs > 0) return `in ${hrs}h ${rem}m`;
  return `in ${rem}m`;
}

export default function FixtureDetailCard({ playerToken, fixtureId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    getPlayerFixtureDetail(playerToken, fixtureId)
      .then(d => { if (live) setDetail(d); })
      .catch(e => { console.error(e); if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [playerToken, fixtureId]);

  // Re-render the countdown every 60s while mounted.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const wrap = {
    background: "var(--bg)", borderTop: "0.5px solid rgba(255,255,255,0.06)",
    padding: "12px 16px",
  };
  const meta = { fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 300, color: "var(--t2)" };
  const label = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, color: "var(--t2)", letterSpacing: "0.06em" };

  if (loading) return <div style={wrap}><span style={meta}>Loading…</span></div>;
  if (failed || !detail) return <div style={wrap}><span style={meta}>Couldn't load fixture.</span></div>;

  const f = detail.fixture;
  const isPast = PAST.includes(f.status);
  const fmtDate = f.scheduled_date
    ? new Date(`${f.scheduled_date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : "Date TBC";
  const time = f.kickoff_time ? f.kickoff_time.slice(0, 5) : null;
  const cd = !isPast ? countdownText(f.scheduled_date, f.kickoff_time) : null;

  const goals = (detail.events || []).filter(e => e.event_type === "goal");
  const nameById = {};
  [...(detail.home_squad || []), ...(detail.away_squad || [])].forEach(p => { nameById[p.id] = p.name; });

  const GoalCol = ({ goals, teamId, nameById, align }) => {
    const mine = goals.filter(g => g.team_id === teamId);
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: align }}>
        {mine.length === 0 ? (
          <span style={{ ...meta }}>—</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {mine.map(g => (
              <span key={g.id} style={{
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--t1)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {nameById[g.player_id] || g.player_name_override || "Unknown"}{" "}
                <span style={{ fontFamily: "'Bebas Neue', sans-serif", color: "var(--t2)" }}>
                  {g.minute != null ? `${g.minute}'` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const SquadCol = ({ teamName, squad, mine }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: "'DM Sans', sans-serif", fontWeight: mine ? 600 : 500, fontSize: 12,
        color: mine ? "var(--gold)" : "var(--t1)", marginBottom: 6,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {teamName}{mine ? " (you)" : ""}
      </div>
      {!squad || !squad.length ? (
        <span style={meta}>No squad registered</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {squad.map(p => (
            <span key={p.id} style={{
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 400,
              color: p.suspension_until ? "var(--red)" : "var(--t1)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {p.shirt_number != null ? `${p.shirt_number}. ` : ""}{p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={wrap}>
      {/* meta line */}
      <div style={{ ...meta, marginBottom: 8 }}>
        {detail.competition?.name}
        {f.round_name ? ` · ${f.round_name}` : ` · Week ${f.week_number}`}
        {" · "}{fmtDate}{time ? ` · ${time}` : ""}
        {detail.pitch?.name ? ` · ${detail.pitch.name}` : ""}
        {detail.venue?.name ? ` · ${detail.venue.name}` : ""}
      </div>

      {/* scoreline / matchup */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        padding: "6px 0 10px",
      }}>
        <span style={{
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14,
          color: "var(--t1)", flex: 1, textAlign: "right",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {detail.home_team?.name}
        </span>
        {isPast && f.home_score != null ? (
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)" }}>
            {f.home_score}–{f.away_score}
          </span>
        ) : (
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--t2)" }}>v</span>
        )}
        <span style={{
          fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: 14,
          color: "var(--t1)", flex: 1, textAlign: "left",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {detail.away_team?.name}
        </span>
      </div>

      {cd && (
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <span style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "var(--gold)",
            letterSpacing: "0.04em",
          }}>
            {cd}
          </span>
        </div>
      )}

      {/* goal events (completed) — split by team so each side's scorers sit under their own column */}
      {goals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span style={label}>GOALS</span>
          <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
            <GoalCol goals={goals} teamId={f.home_team_id} nameById={nameById} align="left" />
            <GoalCol goals={goals} teamId={f.away_team_id} nameById={nameById} align="right" />
          </div>
        </div>
      )}

      {/* squads */}
      <div style={{ display: "flex", gap: 16, marginBottom: 4 }}>
        <SquadCol teamName={detail.home_team?.name} squad={detail.home_squad} mine={detail.is_home} />
        <SquadCol teamName={detail.away_team?.name} squad={detail.away_squad} mine={!detail.is_home} />
      </div>

      {/* opposition intel (lazy) */}
      <OppositionIntel playerToken={playerToken} fixtureId={fixtureId} />
    </div>
  );
}
