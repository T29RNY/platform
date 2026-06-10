import React, { useEffect, useRef, useState } from "react";
import Crest from "./Crest.jsx";
import GoalCelebration from "./GoalCelebration.jsx";
import { teamColour, displayMinute, matchMinute, timeShort } from "../lib/format.js";

// Score digit that punches when its value changes.
function ScoreNum({ value, cls }) {
  const [punch, setPunch] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setPunch(false);
      const raf = requestAnimationFrame(() => setPunch(true));
      const t = setTimeout(() => setPunch(false), 750);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
  }, [value]);
  return <span className={`${cls}${punch ? " scorepunch" : ""}`}>{value}</span>;
}

const EVT_CLS = { goal: "goal", own_goal: "og", yellow_card: "yc", red_card: "rc", substitution: "sub" };
const EVT_LBL = { goal: "Goal", own_goal: "Own goal", yellow_card: "Yellow card", red_card: "Red card", substitution: "Sub" };

function rankLine(comp, teamId) {
  const rows = comp?.standings_live || [];
  const idx = rows.findIndex((r) => r.team_id === teamId);
  if (idx < 0) return null;
  const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || "th"}`;
  const form = rows[idx].form || [];
  let note = "";
  if (form.length >= 3 && !form.includes("L")) note = `Unbeaten in ${form.length}`;
  else if (form.length) note = `${form.filter((f) => f === "W").length} W in last ${form.length}`;
  return { num: ord(idx + 1), note };
}

function HeroTeam({ name, primary, secondary, comp, teamId }) {
  const c = teamColour(primary, name || "");
  const rank = rankLine(comp, teamId);
  return (
    <div className="hero-team">
      <div className="hero-team__crestwrap" style={{ "--c-pulse": `color-mix(in srgb, ${c} 45%, transparent)` }}>
        <Crest name={name} primary={primary} secondary={secondary} />
      </div>
      <div className="hero-team__name">{name}</div>
      {rank && (
        <div className="hero-team__rank">
          <span className="num">{rank.num}</span> {rank.note}
        </div>
      )}
    </div>
  );
}

// Featured-match hero (HANDOVER §6.2) with up-next + idle fallbacks (§8 rule 7).
export default function Hero({ featured, comp, serverOffset, celebration, venue, customMessage, fading }) {
  const { fixture: f, storyTag, mode } = featured;
  const cH = f ? teamColour(f.home_primary_colour, f.home_team_name || "") : "#1E5BAA";
  const cA = f ? teamColour(f.away_primary_colour, f.away_team_name || "") : "#C0392B";

  if (mode !== "live") {
    return (
      <article className={`hero${fading ? " hero-fading" : ""}`} style={{ "--c-h": cH, "--c-a": cA }}>
        <div className="hero__bar">
          <div className="hero__bar-l">
            <span className="comp-badge">{mode === "upnext" ? f?.competition_name || "Up next" : venue?.name || ""}</span>
          </div>
        </div>
        <div className="hero-idle">
          {mode === "upnext" && f ? (
            <>
              <div className="hero-idle__kicker">Up next{f.pitch_name ? ` · ${f.pitch_name}` : ""}</div>
              <div className="hero-idle__title">
                {f.home_team_name} <span style={{ color: "var(--ink-4)" }}>v</span> {f.away_team_name || "—"}
              </div>
              <div className="hero-idle__ko">{timeShort(f.kickoff_time)}</div>
            </>
          ) : (
            <>
              <div className="hero-idle__kicker">Welcome</div>
              <div className="hero-idle__title">{venue?.name || "Matchday Wall"}</div>
              {customMessage && <div className="hero-idle__sub">{customMessage}</div>}
            </>
          )}
        </div>
      </article>
    );
  }

  const events = f.recent_events || [];
  const minNow = matchMinute(f.actual_kickoff_at, serverOffset) ?? 0;
  const recent = events.filter((e) => (e.minute ?? 0) >= minNow - 10 && e.type !== "period_change");
  const hRecent = recent.filter((e) => e.team_id === f.home_team_id).length;
  const aRecent = recent.filter((e) => e.team_id === f.away_team_id).length;
  const tot = hRecent + aRecent;
  const hPct = tot ? Math.round((hRecent / tot) * 100) : 50;
  const lastGoal = events.find((e) => e.type === "goal" || e.type === "own_goal");
  const strip = events.filter((e) => e.type !== "period_change").slice(0, 4);
  const titleBits = [f.round_name, f.pitch_name, f.official_name ? `Ref ${f.official_name}` : null].filter(Boolean);

  return (
    <article className={`hero${fading ? " hero-fading" : ""}`} style={{ "--c-h": cH, "--c-a": cA }}>
      <GoalCelebration celebration={celebration} />
      <div className="hero__bar">
        <div className="hero__bar-l">
          <span className="comp-badge">{f.competition_name}</span>
          {titleBits.length > 0 && <span className="hero__title">{titleBits.join(" · ")}</span>}
        </div>
        <div className="hero__bar-r">
          {storyTag && <span className="hero__story">{storyTag}</span>}
          <span className="hero__live">
            <span className="dot" /> LIVE <span className="hero__minute">{displayMinute(f, serverOffset)}</span>
          </span>
        </div>
      </div>

      <div className="hero__body">
        <HeroTeam name={f.home_team_name} primary={f.home_primary_colour} secondary={f.home_secondary_colour} comp={comp} teamId={f.home_team_id} />
        <div className="hero-score">
          <div className="hero-score__nums">
            <ScoreNum cls="h" value={f.home_score ?? 0} />
            <span className="dash">–</span>
            <ScoreNum cls="a" value={f.away_score ?? 0} />
          </div>
          {lastGoal && (
            <div className="hero-score__last">
              <span className="ico">⚽</span> {lastGoal.minute != null ? `${lastGoal.minute}' · ` : ""}{lastGoal.player_name || "Goal"}
            </div>
          )}
        </div>
        <HeroTeam name={f.away_team_name} primary={f.away_primary_colour} secondary={f.away_secondary_colour} comp={comp} teamId={f.away_team_id} />
      </div>

      <div className="hero__footer">
        <div className="momentum">
          <span className="momentum__label">Momentum (last 10')</span>
          <div className="momentum__bar">
            <div className="momentum__h" style={{ width: `${hPct}%` }} />
            <div className="momentum__a" style={{ width: `${100 - hPct}%` }} />
          </div>
          <span className="momentum__nums">
            <span className="h">{hPct}</span> / <span className="a">{100 - hPct}</span>
          </span>
        </div>
        {strip.length > 0 && (
          <div className="event-strip">
            {strip.map((ev, i) => {
              const cls = EVT_CLS[ev.type] || "";
              const latest = i === 0 && (ev.type === "goal" || ev.type === "own_goal");
              const teamName = ev.team_id === f.home_team_id ? f.home_team_name : f.away_team_name;
              return (
                <div className={`event-card ${cls}${latest ? " latest" : ""}`} key={`${ev.type}-${ev.minute}-${ev.player_name}-${i}`}>
                  <div className="event-card__ico">{ev.type === "goal" || ev.type === "own_goal" ? "⚽" : ""}</div>
                  <div className="event-card__txt">
                    <div className="event-card__plr">{ev.player_name || EVT_LBL[ev.type] || ev.type}</div>
                    <div className="event-card__sub">{EVT_LBL[ev.type] || ev.type}{teamName ? ` · ${teamName}` : ""}</div>
                  </div>
                  <div className="event-card__min">{ev.minute != null ? `${ev.minute}'` : ""}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
