import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { teamColour } from "../lib/format.js";

export default function TopScorersZone({ competition }) {
  const scorers = (competition?.top_scorers || []).slice(0, 6);
  return (
    <div className="zone" style={{ flex: "0 0 auto", maxHeight: "38%" }}>
      <div className="zone-head">
        <span className="zone-title">Top Scorers</span>
        <span className="zone-tag gold">⚽ Golden Boot</span>
      </div>
      <div className="zone-body">
        {scorers.length === 0 ? (
          <div className="empty"><div>No goals yet this season</div></div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={competition.competition_id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              {scorers.map((s, i) => {
                const c = teamColour(s.primary_colour, s.team_name);
                return (
                  <div key={s.player_id || i} className={`scorer-row${i === 0 ? " boot" : ""}`}>
                    <span className="scorer-rank">{i + 1}</span>
                    <span className="scorer-id">
                      <span className="tbl-chip" style={{ background: c, color: c }} />
                      <span style={{ minWidth: 0 }}>
                        <div className="scorer-name">{s.name}</div>
                        <div className="scorer-team">{s.team_name}</div>
                      </span>
                    </span>
                    <span className="scorer-goals">{s.goals}<small>GLS</small></span>
                  </div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
