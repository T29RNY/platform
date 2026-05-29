import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Score from "./Score.jsx";
import { matchMinute, eventLabel, teamColour } from "../lib/format.js";

function LiveFixtureCard({ fx, serverOffset }) {
  const minute = matchMinute(fx.actual_kickoff_at, serverOffset);
  const homeC = teamColour(fx.home_primary_colour, fx.home_team_name);
  const awayC = teamColour(fx.away_primary_colour, fx.away_team_name);
  const events = (fx.recent_events || []).slice(0, 5);

  return (
    <motion.div
      layout
      className="fixcard"
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
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
          <span className="team-bar" style={{ background: homeC, color: homeC }} />
          <span className="team-name">{fx.home_team_name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <Score value={fx.home_score ?? 0} />
          <span className="score-sep">–</span>
          <Score value={fx.away_score ?? 0} />
        </div>
        <div className="team away">
          <span className="team-bar" style={{ background: awayC, color: awayC }} />
          <span className="team-name">{fx.away_team_name}</span>
        </div>
      </div>

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
              <LiveFixtureCard key={fx.fixture_id} fx={fx} serverOffset={serverOffset} />
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
