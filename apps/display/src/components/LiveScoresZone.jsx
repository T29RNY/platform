import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Score from "./Score.jsx";
import Crest from "./Crest.jsx";
import { matchMinute, eventLabel, teamColour } from "../lib/format.js";

function LiveFixtureCard({ fx, serverOffset, big }) {
  const minute = matchMinute(fx.actual_kickoff_at, serverOffset);
  const homeC = teamColour(fx.home_primary_colour, fx.home_team_name);
  const awayC = teamColour(fx.away_primary_colour, fx.away_team_name);
  const events = (fx.recent_events || []).slice(0, 5);
  // latest goal → animated lower-third
  const lastGoal = (fx.recent_events || []).find((e) => e.type === "goal" || e.type === "own_goal");
  const crestSize = big ? 3.4 : 2.2;

  return (
    <motion.div
      layout
      className="fixcard"
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* team-colour wash down each flank */}
      <span className="fixcard-wash" style={{ background: `linear-gradient(90deg, ${homeC}22, transparent 22%, transparent 78%, ${awayC}22)` }} />

      <div className="fixcard-top">
        <div className="fixcard-badges">
          {fx.pitch_name && <span className="badge">{fx.pitch_name}</span>}
          <span className="badge">{fx.competition_name}</span>
        </div>
        <span className="clockbug">
          <span className="livedot" />
          {minute != null ? `${minute}'` : "LIVE"}
        </span>
      </div>

      <div className="scoreline">
        <div className="team home">
          <Crest name={fx.home_team_name} primary={fx.home_primary_colour} secondary={fx.home_secondary_colour} size={crestSize} />
          <span className="team-name">{fx.home_team_name}</span>
        </div>
        <div className="score-wrap">
          <Score value={fx.home_score ?? 0} />
          <span className="score-sep">–</span>
          <Score value={fx.away_score ?? 0} />
        </div>
        <div className="team away">
          <Crest name={fx.away_team_name} primary={fx.away_primary_colour} secondary={fx.away_secondary_colour} size={crestSize} />
          <span className="team-name">{fx.away_team_name}</span>
        </div>
      </div>

      {/* lower-third: the most recent goal sweeps in */}
      <div className="lowerthird-slot">
        <AnimatePresence mode="wait">
          {lastGoal && lastGoal.player_name && (
            <motion.div
              key={`${lastGoal.minute}-${lastGoal.player_name}`}
              className="lowerthird"
              style={{ background: `linear-gradient(90deg, ${lastGoal.team_id === fx.away_team_id ? awayC : homeC}, transparent)` }}
              initial={{ x: "-103%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="lt-glyph">⚽</span>
              <span className="lt-name">{lastGoal.player_name}{lastGoal.type === "own_goal" ? " (OG)" : ""}</span>
              {lastGoal.minute != null && <span className="lt-min">{lastGoal.minute}'</span>}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="evrow">
          <AnimatePresence initial={false}>
            {events.map((ev, i) => {
              const { glyph, text } = eventLabel(ev);
              return (
                <motion.span
                  key={`${ev.minute}-${ev.player_name}-${i}`}
                  className="evchip"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {glyph} {text} {ev.minute != null && <span className="min">{ev.minute}'</span>}
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export default function LiveScoresZone({ fixtures, serverOffset }) {
  const n = Math.min(fixtures.length, 6);
  return (
    <div className="zone" style={{ flex: 1 }}>
      <div className="zone-head">
        <span className="zone-title">Live Now</span>
        <span className="zone-tag">{fixtures.length} match{fixtures.length === 1 ? "" : "es"}</span>
      </div>
      <div className="zone-body">
        <motion.div layout className="live-grid" data-n={n}>
          <AnimatePresence>
            {fixtures.slice(0, 6).map((fx) => (
              <LiveFixtureCard key={fx.fixture_id} fx={fx} serverOffset={serverOffset} big={n <= 2} />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
